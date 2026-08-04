"""Módulo de processamento e otimização de imagens."""

import io

from PIL import Image


def comprimir_imagem(
    bytes_imagem: bytes,
    qualidade: int = 60,
    max_dimensao: int = 1600,
) -> bytes | None:
    """Recebe os bytes de uma imagem e a comprime no formato JPEG.

    Redimensiona se exceder max_dimensao (mantendo a proporção)
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

            img_trabalho = img_trabalho.resize((nova_largura, nova_altura), Image.Resampling.LANCZOS)

        buffer_saida = io.BytesIO()
        img_trabalho.save(buffer_saida, format="JPEG", quality=qualidade, optimize=True)
        return buffer_saida.getvalue()
