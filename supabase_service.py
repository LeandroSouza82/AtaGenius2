"""Modulo de persistencia no Supabase."""

import contextlib
import os
from typing import Any

try:
    from supabase import Client, create_client
except Exception as _supabase_err:
    print(f"[AVISO SUPABASE]: Falha ao importar SDK do Supabase ({_supabase_err})")
    Client = None
    create_client = None  # type: ignore[assignment]


class SupabaseService:
    """Servico encapsulado para integracao com o banco de dados Supabase."""

    def __init__(self) -> None:
        """Inicializa a conexao com o Supabase usando variaveis de ambiente."""
        self.url: str = os.getenv("SUPABASE_URL", "")
        self.key: str = os.getenv("SUPABASE_KEY", "")
        self.client = None

        if self.url and self.key and create_client:
            with contextlib.suppress(Exception):
                self.client = create_client(self.url, self.key)

    def salvar_ata(
        self,
        conteudo_markdown: str,
        qtd_imagens: int = 0,
        possui_audio: bool = False,
    ) -> list[Any] | None:
        """Insere um registro na tabela 'atas' mapeando apenas as colunas existentes."""
        if not self.client:
            return None

        dados = {
            "conteudo": conteudo_markdown,
            "qtd_imagens": qtd_imagens,
            "possui_audio": possui_audio,
        }

        try:
            resposta = self.client.table("atas").insert(dados).execute()
        except Exception as err:  # noqa: BLE001
            print(f"[SupabaseService] Erro ao salvar ata: {err}")  # noqa: T201
            return None
        else:
            return resposta.data

    def listar_atas(self, limite: int = 20) -> list[Any] | None:
        """Busca as ultimas atas cadastradas ordenadas por data de criacao."""
        if not self.client:
            return None

        try:
            resposta = (
                self.client.table("atas")
                .select("*")
                .order("created_at", desc=True)
                .limit(limite)
                .execute()
            )
        except Exception as err:  # noqa: BLE001
            print(f"[SupabaseService] Erro ao listar atas: {err}")  # noqa: T201
            return None
        else:
            return resposta.data

