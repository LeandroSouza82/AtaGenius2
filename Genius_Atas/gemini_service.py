"""Módulo de integração com a API do Google Gemini AI."""

import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()


PROMPT_ATA_NOTARIAL = """
Você é um redator jurídico e corporativo especializado na confecção de atas formais para registro em cartório e assembleias formais.

Analise os materiais fornecidos (áudio gravado da reunião e/ou foto das anotações manuscritas) e elabore a minuta formal da ATA DE REUNIÃO.

REGRAS DE REDAÇÃO E VALIDADE FORMAL:
1. Linguagem: Culta, formal, impessoal e no tempo verbal do pretérito perfeito do indicativo.
2. Fidelidade: Transcreva rigorosamente apenas os fatos, discussões, deliberações e votações que constarem nos materiais. Não invente ou presuma informações.
3. Tratamento de Lacunas: Caso algum dado obrigatório (como horário exato de término ou lista completa de qualificações) não conste nos arquivos, utilize colchetes explicativos como [A preencher na assinatura] ou [Nome legível do participante].

ESTRUTURA OBRIGATÓRIA DA ATA (FORMATO MARKDOWN):

# ATA DA REUNIÃO [TÍTULO/PROPÓSITO DA REUNIÃO]

**1. DATA, HORÁRIO E LOCAL:**
- **Data:** [Data identificada ou preencher]
- **Horário de Início:** [Horário de início] | **Término:** [Horário de encerramento]
- **Local/Plataforma:** [Endereço físico ou link/plataforma virtual]

**2. CONVOCAÇÃO E PRESENÇAS:**
- **Presidente da Mesa:** [Nome / Qualificação]
- **Secretário(a):** [Nome / Qualificação]
- **Participantes Presentes:** [Lista formal de participantes identificados]

**3. ORDEM DO DIA (PAUTA):**
[Enumeração clara dos tópicos/pautas discutidos]

**4. DELIBERAÇÕES E DISCUSSÕES:**
[Relato detalhado e cronológico do que foi discutido, propostas apresentadas, consensos atingidos e resultados de eventuais votações]

**5. PLANO DE AÇÃO E OBRIGAÇÕES (SE HOUVER):**
| Item | Descrição da Ação / Compromisso | Responsável | Prazo Final |
| :--- | :--- | :--- | :--- |

**6. ENCERRAMENTO E LAVRATURA:**
Nada mais havendo a tratar, a reunião foi encerrada, do que se lavrou a presente ata que, lida e achada conforme, vai assinada pelos presentes para que surta seus efeitos legais e seja levada a registro perante o Cartório de Títulos e Documentos competente.

---
**ASSINATURAS DOS PRESENTES:**

_______________________________________
[Nome do Presidente da Mesa]

_______________________________________
[Nome do Secretário]
"""


def processar_ata_multimodal(
    bytes_imagem: bytes | None = None,
    bytes_audio: bytes | None = None,
    mime_audio: str = "audio/mp3",
) -> str:
    """Gera uma ata formal em Markdown a partir de imagem e/ou áudio."""

    # 1. Carregar a chave direto do .env (load_dotenv() já foi chamado no topo do módulo)
    api_key = os.getenv("GEMINI_API_KEY")

    # 2. Validar se a chave foi encontrada e é válida
    if not api_key or not api_key.strip() or api_key.strip() == "Cole_Sua_Chave_Aqui":
        raise ValueError("Chave GEMINI_API_KEY não foi encontrada no arquivo .env")

    api_key = api_key.strip()

    # 3. Validar que ao menos um arquivo foi fornecido
    if not bytes_imagem and not bytes_audio:
        raise ValueError("É necessário fornecer pelo menos uma foto das anotações ou o áudio da reunião.")

    # 4. Instanciar o cliente com a chave explícita
    client = genai.Client(api_key=api_key)

    # 5. Montar os conteúdos multimodais
    contents = [PROMPT_ATA_NOTARIAL]

    if bytes_imagem:
        contents.append(
            types.Part.from_bytes(data=bytes_imagem, mime_type="image/jpeg"),
        )

    if bytes_audio:
        contents.append(
            types.Part.from_bytes(data=bytes_audio, mime_type=mime_audio),
        )

    # 6. Chamar a API com tratamento de erros granular
    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=contents,
        )
        return response.text

    except Exception as exc:
        # Log completo do erro no terminal do servidor para diagnóstico
        print(f"[ERRO TÉCNICO GEMINI]: {exc}")

        erro_str = str(exc).lower()

        # Erros de autenticação / chave inválida (401)
        if any(t in erro_str for t in ("api key", "api_key", "unauthenticated", "invalid key",
                                        "401", "permission denied", "api_key_invalid")):
            raise ValueError(
                "A chave de API do Gemini informada é inválida ou expirou. Verifique suas credenciais."
            ) from exc

        # Recurso/modelo não encontrado (404)
        if any(t in erro_str for t in ("404", "not found", "model not found", "resource not found")):
            raise ValueError(
                "O serviço de inteligência artificial está temporariamente indisponível. Tente novamente em alguns instantes."
            ) from exc

        # Cota / limite de requisições (429)
        if any(t in erro_str for t in ("429", "quota", "rate limit", "resource exhausted", "too many requests")):
            raise ValueError(
                "O limite de uso gratuito da API foi atingido temporariamente. Aguarde alguns instantes e tente novamente."
            ) from exc

        # Erro genérico/desconhecido
        raise ValueError(
            "Não foi possível processar os arquivos e gerar a ata. Verifique se o áudio/imagem está em um formato válido."
        ) from exc



