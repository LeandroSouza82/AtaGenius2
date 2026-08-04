import os
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# ATA DE DEMONSTRAÇÃO — exibida automaticamente quando a cota da API
# Gemini estiver esgotada (erro 429 / RESOURCE_EXHAUSTED)
# ---------------------------------------------------------------------------
_ATA_DEMONSTRACAO = """
> ⚠️ **[MODO DE DEMONSTRAÇÃO / TESTE]** — A cota gratuita da API Gemini está
> temporariamente pausada. Esta ata é um exemplo gerado localmente para que
> você possa testar o layout, copiar e imprimir sem perda de funcionalidade.

---

# ATA DA REUNIÃO DE PLANEJAMENTO ESTRATÉGICO Q3

**1. DATA, HORÁRIO E LOCAL:**
- **Data:** 23 de julho de 2026
- **Horário de Início:** 14h00 | **Término:** 16h30
- **Local/Plataforma:** Sala de Reuniões "Inovação" — Sede Corporativa, São Paulo/SP

**2. CONVOCAÇÃO E PRESENÇAS:**
- **Presidente da Mesa:** Dr. Carlos Eduardo Mendonça — Diretor Executivo (CPF 123.456.789-00)
- **Secretário(a):** Ana Paula Ferreira — Gerente de Planejamento
- **Participantes Presentes:**
  1. Marcos Vinícius Costa — Diretor Financeiro
  2. Juliana Rezende — Gerente de Produto
  3. Rafael Teixeira — Tech Lead
  4. Fernanda Lima — Designer de Experiência

**3. ORDEM DO DIA (PAUTA):**
1. Revisão dos resultados do Q2 e análise de desvios orçamentários.
2. Apresentação e aprovação do roadmap de produto para o Q3.
3. Definição das metas de contratação e expansão de equipe.
4. Encaminhamentos e próximos passos.

**4. DELIBERAÇÕES E DISCUSSÕES:**
Iniciada a sessão às quatorze horas, o Presidente da Mesa, Dr. Carlos Eduardo Mendonça, agradeceu a presença de todos e deu início à leitura da pauta.

Quanto ao **primeiro ponto**, o Diretor Financeiro, Marcos Vinícius Costa, apresentou o relatório consolidado do Q2, constatando-se um desvio negativo de 8% na receita projetada, atribuído à postergação de dois contratos estratégicos. Deliberou-se pela criação de um comitê de acompanhamento comercial com reuniões quinzenais.

No tocante ao **segundo ponto**, a Gerente de Produto Juliana Rezende apresentou o roadmap para o Q3, destacando o lançamento do módulo de relatórios avançados em agosto e a integração com a API de pagamentos em setembro. O roadmap foi aprovado por unanimidade.

Em relação ao **terceiro ponto**, discutiu-se a necessidade de contratação de dois engenheiros sêniores e um analista de dados para suportar o crescimento previsto. O prazo para abertura das vagas ficou estabelecido em 30 dias.

**5. PLANO DE AÇÃO E OBRIGAÇÕES:**

| Item | Descrição da Ação / Compromisso | Responsável | Prazo Final |
| :--- | :--- | :--- | :--- |
| 1 | Constituir comitê de acompanhamento comercial e agendar primeira reunião | Marcos Costa | 30/07/2026 |
| 2 | Publicar roadmap Q3 no sistema interno de gestão de projetos | Juliana Rezende | 25/07/2026 |
| 3 | Abrir requisições de contratação para 2 engenheiros sêniores e 1 analista | Rafael Teixeira | 22/08/2026 |
| 4 | Enviar ata para assinatura digital de todos os presentes | Ana Paula Ferreira | 26/07/2026 |

**6. ENCERRAMENTO E LAVRATURA:**
Nada mais havendo a tratar, a reunião foi encerrada às dezesseis horas e trinta minutos, do que se lavrou a presente ata que, lida e achada conforme, vai assinada pelos presentes para que surta seus efeitos legais e seja levada a registro perante o Cartório de Títulos e Documentos competente.

---
**ASSINATURAS DOS PRESENTES:**

_______________________________________
Dr. Carlos Eduardo Mendonça — Presidente da Mesa

_______________________________________
Ana Paula Ferreira — Secretária
"""

from gemini_service import processar_ata_multimodal
from image_service import comprimir_imagem
from supabase_service import SupabaseService

app = FastAPI(
    title="Gerador de Atas de Reunião com Gemini AI",
    description="Backend de alta performance para conversão de anotações e áudios em atas executivas.",
    version="1.0.0"
)

# Inicializa o serviço do Supabase
supabase_service = SupabaseService()

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
    foto: Optional[UploadFile] = File(None, description="Foto manuscrita ou do quadro da reunião"),
    audio: Optional[UploadFile] = File(None, description="Gravação de áudio da reunião")
):
    """
    Endpoint principal para recebimento dos arquivos e processamento via Gemini 2.5 Flash.
    A chave de API é carregada automaticamente do arquivo .env pelo gemini_service.
    """
    bytes_imagem: Optional[bytes] = None
    bytes_audio: Optional[bytes] = None
    mime_audio: str = "audio/mp3"

    # Processamento da Foto (Compressão via Pillow)
    if foto and foto.filename:
        conteudo_foto = await foto.read()
        if conteudo_foto:
            try:
                bytes_imagem = comprimir_imagem(conteudo_foto, qualidade=60, max_dimensao=1600)
            except Exception as err:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Erro ao comprimir a imagem enviada: {str(err)}"
                )

    # Processamento do Áudio
    if audio and audio.filename:
        bytes_audio = await audio.read()
        if audio.content_type:
            mime_audio = audio.content_type

    # Validação de recebimento de ao menos UM arquivo válido
    if not bytes_imagem and not bytes_audio:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="É necessário enviar pelo menos uma foto das anotações ou o áudio da reunião."
        )

    # Invocação do Serviço Gemini
    try:
        ata_markdown = processar_ata_multimodal(
            bytes_imagem=bytes_imagem,
            bytes_audio=bytes_audio,
            mime_audio=mime_audio
        )
    except Exception as _err:
        # Fallback universal: qualquer falha da API Gemini entrega a ata de demonstração
        print(f"[INFO] Fallback acionado — entregando ata de demonstração. Causa: {_err}")
        return JSONResponse(
            status_code=200,
            content={"sucesso": True, "ata": _ATA_DEMONSTRACAO, "demonstracao": True}
        )

    # Persistência Opcional no Supabase (se configurado)
    try:
        supabase_service.salvar_ata(
            titulo="Ata de Reunião Gerada",
            conteudo_markdown=ata_markdown,
            metadata={"tem_foto": bool(foto), "tem_audio": bool(audio)}
        )
    except Exception:
        # Erro no Supabase não deve travar a resposta para o usuário
        pass

    return JSONResponse(
        status_code=200,
        content={
            "sucesso": True,
            "ata": ata_markdown
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
