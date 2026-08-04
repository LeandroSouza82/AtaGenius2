"""Módulo de processamento e otimização de imagens."""

import io
from typing import Optional

from PIL import Image


def comprimir_imagem(
    bytes_imagem: bytes,
    qualidade: int = 75,
    max_dimensao: int = 1600,
) -> Optional[bytes]:
    """Recebe os bytes de uma imagem e a comprime no formato JPEG.

    Redimensiona se exceder max_dimensao (mantendo a proporção),
    garantindo baixo consumo de memória e boa legibilidade.
    """
    if not bytes_imagem:
        return None

    buffer_entrada = io.BytesIO(bytes_imagem)
    with Image.open(buffer_entrada) as img:
        img_trabalho = img.convert("RGB") if img.mode in ("RGBA", "P", "LA", "1") else img.copy()

        largura, altura = img_trabalho.size

        if largura > max_dimensao or altura > max_dimensao:
            if largura > altura:
                nova_largura = max_dimensao
                nova_altura = int(altura * (max_dimensao / largura))
            else:
                nova_altura = max_dimensao
                nova_largura = int(largura * (max_dimensao / altura))

            img_trabalho = img_trabalho.resize(
                (nova_largura, nova_altura), Image.Resampling.LANCZOS
            )

        buffer_saida = io.BytesIO()
        img_trabalho.save(buffer_saida, format="JPEG", quality=qualidade, optimize=True)
        return buffer_saida.getvalue()


def comprimir_lista_imagens(
    lista_bytes: list[bytes],
    qualidade: int = 75,
    max_dimensao: int = 1600,
) -> list[bytes]:
    """Recebe uma lista de bytes de imagens e retorna todas comprimidas.

    Imagens inválidas ou vazias são silenciosamente descartadas.
    """
    resultado: list[bytes] = []
    for raw in lista_bytes:
        try:
            comprimida = comprimir_imagem(raw, qualidade=qualidade, max_dimensao=max_dimensao)
            if comprimida:
                resultado.append(comprimida)
        except Exception as err:
            print(f"[AVISO IMAGE_SERVICE]: imagem ignorada — {err}")
    return resultado
