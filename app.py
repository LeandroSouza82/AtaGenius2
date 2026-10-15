import contextlib
import logging
import os
import struct
import time
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from gemini_service import processar_ata_multimodal
from image_service import comprimir_lista_imagens
from supabase_service import SupabaseService

logger = logging.getLogger(__name__)


def _erro_geracao_ata(erro: Exception) -> HTTPException:
    """Registra o detalhe técnico no servidor e devolve uma orientação segura ao usuário."""
    mensagem = str(erro).lower()
    logger.exception("Falha ao gerar ata com a API de inteligência artificial")

    if any(termo in mensagem for termo in ("429", "quota", "resource exhausted", "rate limit", "limite de uso", "cota")):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="O limite temporário de uso da inteligência artificial foi atingido. Aguarde alguns minutos e tente novamente.",
        )

    if any(termo in mensagem for termo in ("api key", "api_key", "gemini_api_key", "chave de api", "unauthenticated", "401", "permission denied", "invalida ou expirou")):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A inteligência artificial está indisponível no momento. Tente novamente mais tarde ou avise o suporte.",
        )

    if any(termo in mensagem for termo in ("timeout", "timed out", "temporariamente indisponível", "temporariamente indisponivel", "404", "model not found")):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A inteligência artificial está temporariamente indisponível. Aguarde um pouco e tente novamente.",
        )

    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Não foi possível gerar a ata agora. Confira os arquivos e tente novamente. Nenhuma ata foi gerada.",
    )


app = FastAPI(
    title="Gerador de Atas de Reunião com Gemini AI",
    description="Backend de alta performance para conversão de anotações e áudios em atas executivas.",
    version="2.0.0"
)

# Inicializa o serviço do Supabase
supabase_service = SupabaseService()

# ---------------------------------------------------------------------------
# Acumulador de blocos de audio fracionados (em memoria, por sessao)
# Chave: nome_base do audio  |  Valor: dict com metadados e lista de bytes
# ---------------------------------------------------------------------------
_BLOCOS_PENDENTES: dict[str, dict] = {}

# Tempo (segundos) sem atividade apos o qual uma sessao de blocos e descartada
_TTL_BLOCOS = 1800  # 30 minutos

# Monta o diretório estático para os assets do frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def serve_index():
    """Servidor da página principal index.html"""
    index_path = os.path.join(static_dir, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="Arquivo index.html não encontrado no diretório static.")
    return FileResponse(index_path)


@app.post("/api/gerar-ata")
async def gerar_ata(
    imagens: Optional[list[UploadFile]] = File(None, description="Uma ou mais fotos de anotações manuscritas ou do quadro"),
    audio: Optional[UploadFile] = File(None, description="Gravação de áudio da reunião"),
):
    """
    Endpoint principal para recebimento dos arquivos e processamento via Gemini 3.5 Flash.

    Aceita múltiplas imagens de anotações e/ou um arquivo de áudio.
    Todas as imagens são comprimidas automaticamente antes do envio.
    O áudio é convertido para mono/32kbps quando pydub+ffmpeg estiverem disponíveis.
    A chave de API é carregada automaticamente do arquivo .env pelo gemini_service.
    """
    lista_bytes_imagens: list[bytes] = []
    bytes_audio: Optional[bytes] = None
    mime_audio: str = "audio/mp3"

    # --- Processamento das Imagens (compressão via Pillow) ---
    if imagens:
        raw_imagens: list[bytes] = []
        for upload in imagens:
            if not upload or not upload.filename:
                continue
            conteudo = await upload.read()
            if conteudo:
                raw_imagens.append(conteudo)

        if raw_imagens:
            try:
                lista_bytes_imagens = comprimir_lista_imagens(
                    raw_imagens, qualidade=75, max_dimensao=1600
                )
            except Exception as err:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Não foi possível ler uma das imagens. Confira se os arquivos são imagens válidas e tente novamente."
                )

    # --- Processamento do Áudio ---
    if audio and audio.filename:
        bytes_audio = await audio.read()
        if audio.content_type:
            mime_audio = audio.content_type

    # --- Validação: ao menos um arquivo válido ---
    if not lista_bytes_imagens and not bytes_audio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Envie pelo menos uma foto válida das anotações ou o áudio da reunião para gerar a ata."
        )

    # --- Invocação do Serviço Gemini ---
    try:
        ata_markdown = processar_ata_multimodal(
            bytes_imagens=lista_bytes_imagens if lista_bytes_imagens else None,
            bytes_audio=bytes_audio,
            mime_audio=mime_audio,
        )
    except Exception as err:
        raise _erro_geracao_ata(err) from err

    if not isinstance(ata_markdown, str) or not ata_markdown.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="A inteligência artificial não retornou uma ata. Tente novamente em alguns instantes.",
        )

    # --- Persistencia Opcional no Supabase (silenciosa — nao interrompe o fluxo) ---
    with contextlib.suppress(Exception):
        supabase_service.salvar_ata(
            conteudo_markdown=ata_markdown or "",
            qtd_imagens=len(lista_bytes_imagens),
            possui_audio=bool(bytes_audio),
        )

    return JSONResponse(
        status_code=200,
        content={"sucesso": True, "ata": ata_markdown}
    )


@app.post("/api/gerar-ata-bloco")
async def gerar_ata_bloco(
    audio: UploadFile = File(..., description="Bloco de audio WAV otimizado"),
    bloco_atual: int  = Form(..., description="Numero do bloco atual (1-based)"),
    total_blocos: int = Form(..., description="Total de blocos a receber"),
    duracao_total: float = Form(0, description="Duracao total da gravacao em segundos"),
    imagens: Optional[list[UploadFile]] = File(None, description="Fotos de anotacoes (somente no primeiro bloco)"),
):
    """
    Recebe blocos fracionados de audio WAV (reunioes longas > 10 min).

    O cliente envia N requisicoes sequenciais — uma por bloco.
    Os bytes de audio sao acumulados em memoria ate o ultimo bloco chegar,
    momento em que o audio e concatenado e processado pelo Gemini em uma
    unica chamada, garantindo coerencia narrativa da ata.

    Blocos orfaos (sessao sem atividade por 30 min) sao descartados
    automaticamente na proxima requisicao recebida.
    """
    # --- Limpeza de sessoes expiradas ---
    agora = time.time()
    expirados = [
        k for k, v in _BLOCOS_PENDENTES.items()
        if agora - v.get("ts", 0) > _TTL_BLOCOS
    ]
    for k in expirados:
        del _BLOCOS_PENDENTES[k]

    # --- Deriva a chave de sessao a partir do nome do arquivo do primeiro bloco ---
    # Ex.: "reuniao_20260723_1400_bloco01.wav" -> "reuniao_20260723_1400"
    nome_arquivo = audio.filename or "audio_bloco"
    # Remove sufixo "_blocoNN.wav" para obter o nome base
    partes = nome_arquivo.rsplit("_bloco", 1)
    chave_sessao = partes[0] if len(partes) == 2 else nome_arquivo

    # --- Inicializa a sessao no primeiro bloco ---
    if bloco_atual == 1:
        _BLOCOS_PENDENTES[chave_sessao] = {
            "blocos":     [],
            "imagens":    [],
            "total":      total_blocos,
            "duracao":    duracao_total,
            "ts":         agora,
        }

    sessao = _BLOCOS_PENDENTES.get(chave_sessao)
    if sessao is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Sessao de blocos nao encontrada para '{chave_sessao}'. "
                "O bloco 1 deve ser enviado antes dos demais."
            )
        )

    # --- Acumula o bloco de audio ---
    bytes_bloco = await audio.read()
    if bytes_bloco:
        sessao["blocos"].append(bytes_bloco)
    sessao["ts"] = agora

        # --- Acumula imagens (chegam somente no bloco 1) ---
    if imagens:
        raw_imgs = []
        for upload in imagens:
            if upload and upload.filename:
                conteudo = await upload.read()
                if conteudo:
                    raw_imgs.append(conteudo)
        if raw_imgs:
            try:
                sessao["imagens"] = comprimir_lista_imagens(
                    raw_imgs, qualidade=75, max_dimensao=1600
                )
            except Exception as err:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Não foi possível ler uma das imagens. Confira se os arquivos são imagens válidas e tente novamente."
                )

    # --- Aguarda o ultimo bloco para processar ---
    blocos_recebidos = len(sessao["blocos"])
    if blocos_recebidos < sessao["total"]:
        return JSONResponse(
            status_code=200,
            content={
                "sucesso":  True,
                "parcial":  True,
                "recebidos": blocos_recebidos,
                "total":    sessao["total"],
                "ata":      None,
            }
        )

    # --- Todos os blocos chegaram: concatena os bytes de audio ---
    # Os blocos WAV sao PCM 16-bit mono 16kHz — concatena-se apenas os
    # dados de amostra (pulando o cabecalho de 44 bytes de cada bloco)
    # e reconstroi um unico cabecalho WAV valido.
    blocos_bytes: list[bytes] = sessao["blocos"]
    lista_bytes_imagens: list[bytes] = sessao.get("imagens", [])

    del _BLOCOS_PENDENTES[chave_sessao]  # libera memoria

    # Concatenacao WAV: cabecalho do primeiro bloco + dados de todos os blocos
    WAV_HEADER = 44
    dados_pcm = b"".join(b[WAV_HEADER:] for b in blocos_bytes)
    cabecalho  = bytearray(blocos_bytes[0][:WAV_HEADER])

            # Atualiza tamanho total no cabecalho RIFF (bytes 4-7) e data (bytes 40-43)
    total_dados = len(dados_pcm)
    struct.pack_into("<I", cabecalho, 4,  36 + total_dados)
    struct.pack_into("<I", cabecalho, 40, total_dados)

    bytes_audio_final = bytes(cabecalho) + dados_pcm
    mime_audio_final  = "audio/wav"

    # --- Processa com Gemini ---
    try:
        ata_markdown = processar_ata_multimodal(
            bytes_imagens=lista_bytes_imagens if lista_bytes_imagens else None,
            bytes_audio=bytes_audio_final,
            mime_audio=mime_audio_final,
        )
    except Exception as err:
        raise _erro_geracao_ata(err) from err

    if not isinstance(ata_markdown, str) or not ata_markdown.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="A inteligência artificial não retornou uma ata. Tente novamente em alguns instantes.",
        )

    # --- Persistencia opcional ---
    with contextlib.suppress(Exception):
        supabase_service.salvar_ata(
            conteudo_markdown=ata_markdown or "",
            qtd_imagens=len(lista_bytes_imagens),
            possui_audio=True,
        )

    return JSONResponse(
        status_code=200,
        content={"sucesso": True, "parcial": False, "ata": ata_markdown}
    )


@app.get("/api/historico")
async def obter_historico():
    """Retorna a lista das ultimas atas salvas no Supabase."""
    atas = supabase_service.listar_atas()
    return JSONResponse(
        status_code=200,
        content={"sucesso": True, "atas": atas or []}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=True)

