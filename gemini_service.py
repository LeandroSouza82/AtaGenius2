"""Modulo de integracao com a API do Google Gemini AI."""

import io
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types

# Garante que o .env seja lido da raiz do projeto, nao do diretorio de trabalho
_ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH, override=True)


PROMPT_ATA_NOTARIAL = """Voce e um Tabeliao Digital de Alta Precisao, especializado em redigir atas formais notariais a partir de materiais multimodais complexos (lote de imagens de anotacoes manuscritas e/ou gravacao de audio de reuniao).

=================================================
FASE 1 - ANALISE SEQUENCIAL DOS MATERIAIS
=================================================

IMAGENS (anotacoes manuscritas):
- Trate cada imagem recebida como uma FOLHA/PAGINA de um mesmo bloco de anotacoes, em ordem cronologica (imagem 1 = inicio da reuniao, ultima imagem = encerramento).
- Leia CADA folha na integra antes de unificar os topicos. Nao repita informacoes ja extraidas em folhas anteriores.
- Ao transcrever termos tecnicos, nomes proprios, siglas, numeros e datas, seja absolutamente rigoroso. Prefira a grafia exata do manuscrito; use o audio como validador secundario.
- Trechos de CALIGRAFIA ILEGIVEL que NAO aparecam no audio devem ser sinalizados com [Ilegivel nas anotacoes].

AUDIO (gravacao da reuniao):
- Use o audio como fonte primaria de contexto, narrativa e sequencia de fatos.
- Utilize o audio para preencher o sentido de anotacoes manuscritas resumidas, abreviadas ou incompletas.
- Cruze nomes de participantes, datas, numeros e decisoes mencionados no audio com as notas visuais. Em caso de divergencia entre audio e texto manuscrito, registre ambas as versoes entre colchetes: [Audio: X | Manuscrito: Y].
- Ignore hesitacoes, conversas paralelas, ruidos e comentarios nao relacionados ao objeto da reuniao.

=================================================
FASE 2 - REDACAO DA ATA FORMAL
=================================================

REGRAS ABSOLUTAS DE REDACAO:
1. Linguagem: Culta, formal, impessoal, no preterito perfeito do indicativo. Proibido o uso de primeira pessoa.
2. Fidelidade total: Registre SOMENTE fatos, discussoes, deliberacoes e votacoes presentes nos materiais. JAMAIS invente, suponha ou extrapole informacoes.
3. Lacunas obrigatorias: Dados ausentes nos materiais devem ser sinalizados com colchetes descritivos, ex.: [Horario de encerramento nao identificado - a preencher na assinatura] ou [Nome legivel: verificar na lista de presenca].
4. Tabela de Plano de Acao: Inclua SOMENTE quando houver compromissos, tarefas ou prazos explicitamente atribuidos a responsaveis nos materiais.
5. Assinaturas: Mantenha o bloco de assinaturas ao final para impressao e exportacao em PDF.

=================================================
FASE 3 - ESTRUTURA OBRIGATORIA (FORMATO MARKDOWN)
=================================================

# ATA DA REUNIAO - [TITULO/PROPOSITO DA REUNIAO]

**1. DATA, HORARIO E LOCAL:**
- **Data:** [Data identificada nos materiais, ou [A preencher]]
- **Horario de Inicio:** [Horario] | **Termino:** [Horario, ou [Nao identificado]]
- **Local/Plataforma:** [Endereco fisico, sala ou link/plataforma virtual]

**2. CONVOCACAO E PRESENCAS:**
- **Presidente da Mesa:** [Nome completo / Cargo / Qualificacao]
- **Secretario(a):** [Nome completo / Cargo]
- **Participantes Presentes:**
  [Lista numerada com nome, cargo e qualificacao de cada participante identificado]

**3. ORDEM DO DIA (PAUTA):**
[Enumeracao objetiva dos topicos discutidos, em ordem cronologica]

**4. DELIBERACOES E DISCUSSOES:**
[Relato detalhado, cronologico e impessoal de cada topico: contexto apresentado, discussoes travadas, propostas, consensos e resultado de eventuais votacoes. Use subtitulos em negrito para cada ponto da pauta, ex.: **Ponto 1 -**]

**5. PLANO DE ACAO E OBRIGACOES:**
[Incluir tabela APENAS se houver tarefas/compromissos atribuidos. Caso contrario, escrever: Nao foram atribuidas tarefas formais nesta reuniao.]

| No | Descricao da Acao / Compromisso | Responsavel | Prazo Final |
| :-- | :--- | :--- | :---: |

**6. ENCERRAMENTO E LAVRATURA:**
Nada mais havendo a tratar, a reuniao foi encerrada [horario ou [horario nao identificado]], do que se lavrou a presente ata que, lida e achada conforme, vai assinada pelos presentes para que surta seus efeitos legais e, se for o caso, seja levada a registro perante o Cartorio de Titulos e Documentos competente.

---
**ASSINATURAS DOS PRESENTES:**

_______________________________________
[Nome do Presidente da Mesa - Cargo]

_______________________________________
[Nome do Secretario(a) - Cargo]

[Repetir bloco de assinatura para cada participante identificado que deva assinar]
"""


def _otimizar_audio(bytes_audio: bytes, mime_audio: str) -> tuple[bytes, str]:
    """Converte o audio para mono 32kbps via pydub (requer ffmpeg no PATH).

    Em caso de falha (ffmpeg indisponivel, formato insuportado, etc.) retorna
    os bytes originais sem alterar, garantindo que o fluxo nunca quebre.
    """
    try:
        from pydub import AudioSegment  # importacao tardia - opcional
    except ImportError:
        print("[AVISO GEMINI_SERVICE]: pydub nao instalado - audio enviado sem otimizacao.")
        return bytes_audio, mime_audio

    try:
        # Derivar o formato a partir do MIME (ex: "audio/mp4" -> "mp4")
        fmt = mime_audio.split("/")[-1].replace("mpeg", "mp3")
        audio = AudioSegment.from_file(io.BytesIO(bytes_audio), format=fmt)
        audio = audio.set_channels(1).set_frame_rate(16000)

        buffer = io.BytesIO()
        audio.export(buffer, format="mp3", bitrate="32k")
        return buffer.getvalue(), "audio/mp3"
    except Exception as err:
        print(f"[AVISO GEMINI_SERVICE]: otimizacao de audio falhou ({err}) - enviando original.")
        return bytes_audio, mime_audio


def processar_ata_multimodal(
    bytes_imagens: Optional[list[bytes]] = None,
    bytes_audio: Optional[bytes] = None,
    mime_audio: str = "audio/mp3",
) -> str:
    """Gera uma ata formal em Markdown a partir de uma lista de imagens e/ou audio."""

    # 1. Carregar a chave direto do .env
    api_key = os.getenv("GEMINI_API_KEY")

    # 2. Validar se a chave foi encontrada e e valida
    if not api_key or not api_key.strip() or api_key.strip() == "Cole_Sua_Chave_Aqui":
        raise ValueError("Chave GEMINI_API_KEY nao foi encontrada no arquivo .env")

    api_key = api_key.strip()

    # 3. Validar que ao menos um arquivo foi fornecido
    tem_imagens = bool(bytes_imagens)
    tem_audio = bool(bytes_audio)
    if not tem_imagens and not tem_audio:
        raise ValueError(
            "E necessario fornecer pelo menos uma foto das anotacoes ou o audio da reuniao."
        )

    # 4. Instanciar o cliente com a chave explicita
    client = genai.Client(api_key=api_key)

    # 5. Montar os conteudos multimodais
    contents: list = [PROMPT_ATA_NOTARIAL]

    # 5a. Anexar todas as imagens comprimidas
    if bytes_imagens:
        for img_bytes in bytes_imagens:
            contents.append(
                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")
            )

    # 5b. Otimizar e anexar audio (se fornecido)
    if bytes_audio:
        audio_otimizado, mime_otimizado = _otimizar_audio(bytes_audio, mime_audio)
        contents.append(
            types.Part.from_bytes(data=audio_otimizado, mime_type=mime_otimizado)
        )

    # 6. Chamar a API com tratamento de erros granular
    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=contents,
        )
        return response.text

    except Exception as exc:
        print(f"[ERRO TECNICO GEMINI]: {exc}")

        erro_str = str(exc).lower()

        if any(t in erro_str for t in ("api key", "api_key", "unauthenticated", "invalid key",
                                        "401", "permission denied", "api_key_invalid")):
            raise ValueError(
                "A chave de API do Gemini informada e invalida ou expirou. "
                "Verifique suas credenciais."
            ) from exc

        if any(t in erro_str for t in ("404", "not found", "model not found", "resource not found")):
            raise ValueError(
                "O servico de inteligencia artificial esta temporariamente indisponivel. "
                "Tente novamente em alguns instantes."
            ) from exc

        if any(t in erro_str for t in ("429", "quota", "rate limit", "resource exhausted",
                                        "too many requests")):
            raise ValueError(
                "O limite de uso gratuito da API foi atingido temporariamente. "
                "Aguarde alguns instantes e tente novamente."
            ) from exc

        raise ValueError(
            "Nao foi possivel processar os arquivos e gerar a ata. "
            "Verifique se o audio/imagem esta em um formato valido."
        ) from exc
