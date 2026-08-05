/**
 * AtaGenius — Controle do Modal e Integração com o Histórico de Atas
 */
document.addEventListener('DOMContentLoaded', () => {
    const btnAbrir = document.getElementById('btnAbrirHistorico');
    const btnFechar = document.getElementById('btnFecharHistorico');
    const backdrop = document.getElementById('histBackdrop');
    const panel = document.getElementById('histPanel');
    const histEmpty = document.getElementById('histEmpty');
    const histList = document.getElementById('histList');
    const histCount = document.getElementById('histCount');

    function abrirHistorico() {
        if (backdrop && panel) {
            backdrop.classList.add('is-open');
            panel.classList.add('is-open');
            document.body.style.overflow = 'hidden'; // Evita scroll do fundo
        }
        carregarHistorico();
    }

    function fecharHistorico() {
        if (backdrop && panel) {
            backdrop.classList.remove('is-open');
            panel.classList.remove('is-open');
            document.body.style.removeProperty('overflow');
        }
    }

    /**
     * Converte o texto Markdown da ata para HTML simples
     */
    function renderizarMarkdown(markdown) {
        if (!markdown) return '';
        let html = markdown
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        html = html.replace(/^&gt;\s?(.*$)/gim, '<blockquote>$1</blockquote>');
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim,  '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim,   '<h1>$1</h1>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g,     '<em>$1</em>');
        html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
        html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/^---$/gim, '<hr>');
        html = html.replace(/\n\n/g, '<br><br>');
        return html;
    }

    /**
     * Busca a lista de atas na API e atualiza a interface dinamicamente
     */
    async function carregarHistorico() {
        if (!histList || !histEmpty) return;

        try {
            const response = await fetch('/api/historico');
            if (!response.ok) {
                throw new Error(`Erro de rede: ${response.status}`);
            }

            const data = await response.json();
            const atas = (data && data.sucesso && Array.isArray(data.atas)) ? data.atas : [];

            if (histCount) {
                histCount.textContent = atas.length;
            }

            if (atas.length === 0) {
                histEmpty.style.display = 'flex';
                histList.style.display = 'none';
                histList.innerHTML = '';
                return;
            }

            histEmpty.style.display = 'none';
            histList.style.display = 'flex';
            histList.innerHTML = '';

            atas.forEach((ata, index) => {
                const li = document.createElement('li');
                li.className = 'hist-item';

                // Formatação de data
                let dataFormatada = 'Data não informada';
                if (ata.created_at) {
                    try {
                        const dt = new Date(ata.created_at);
                        dataFormatada = dt.toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                        });
                    } catch (_) {
                        dataFormatada = String(ata.created_at);
                    }
                }

                // Resumo do título
                const conteudo = ata.conteudo || ata.conteudo_markdown || '';
                let titulo = 'Ata de Reunião';
                const linhas = conteudo
                    .split('\n')
                    .map((l) => l.replace(/^[#*>\s]+/, '').trim())
                    .filter(Boolean);
                if (linhas.length > 0) {
                    titulo = linhas[0].length > 80 ? linhas[0].slice(0, 80) + '…' : linhas[0];
                }

                li.innerHTML = `
                    <div class="hist-item-meta">
                        <span class="hist-item-date">📅 ${dataFormatada}</span>
                    </div>
                    <h3 class="hist-item-title">${titulo}</h3>
                    <div class="hist-item-actions">
                        <button type="button" class="hist-btn-abrir" data-index="${index}">📄 Abrir Ata</button>
                    </div>
                `;

                // Ação ao clicar em "Abrir Ata"
                const btnAbrirAta = li.querySelector('.hist-btn-abrir');
                if (btnAbrirAta) {
                    btnAbrirAta.addEventListener('click', () => {
                        const resultCard = document.getElementById('resultCard');
                        const resultBody = document.getElementById('resultBody');
                        if (resultCard && resultBody) {
                            resultBody.innerHTML = renderizarMarkdown(conteudo);
                            resultCard.style.display = 'flex';
                            resultCard.scrollIntoView({ behavior: 'smooth' });
                        }
                        fecharHistorico();
                    });
                }

                histList.appendChild(li);
            });
        } catch (err) {
            console.error('[Historico] Erro ao carregar historico:', err);
        }
    }

    if (btnAbrir) btnAbrir.addEventListener('click', abrirHistorico);
    if (btnFechar) btnFechar.addEventListener('click', fecharHistorico);
    if (backdrop) backdrop.addEventListener('click', fecharHistorico);
});
