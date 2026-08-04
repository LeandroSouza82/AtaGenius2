document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------------
    // Referências ao DOM
    // -----------------------------------------------------------------------
    const inputFoto      = document.getElementById('inputFoto');
    const dropzoneFoto   = document.getElementById('dropzoneFoto');
    const previewFoto    = document.getElementById('previewFoto');
    const nomeFoto       = document.getElementById('nomeFoto');
    const btnRemoverFoto = document.getElementById('btnRemoverFoto');

    const inputAudio      = document.getElementById('inputAudio');
    const dropzoneAudio   = document.getElementById('dropzoneAudio');
    const previewAudio    = document.getElementById('previewAudio');
    const nomeAudio       = document.getElementById('nomeAudio');
    const btnRemoverAudio = document.getElementById('btnRemoverAudio');

    const btnGerar   = document.getElementById('btnGerar');
    const btnText    = btnGerar.querySelector('.btn-text');
    const spinner    = btnGerar.querySelector('.spinner');
    const alertBox   = document.getElementById('alertBox');
    const resultCard = document.getElementById('resultCard');
    const resultBody = document.getElementById('resultBody');

    // Botões da toolbar de exportação
    const btnCopiar   = document.getElementById('btn-copiar');
    const btnWord     = document.getElementById('btn-word');
    const btnImprimir = document.getElementById('btn-imprimir');
    const btnNovaAta  = document.getElementById('btn-nova-ata');

    let ataGeradaTexto = '';

    // -----------------------------------------------------------------------
    // Drag-and-drop + seleção de arquivos
    // -----------------------------------------------------------------------
    setupFileHandler(inputFoto,  dropzoneFoto,  previewFoto,  nomeFoto,  btnRemoverFoto);
    setupFileHandler(inputAudio, dropzoneAudio, previewAudio, nomeAudio, btnRemoverAudio);

    function setupFileHandler(inputEl, dropzoneEl, previewEl, nameEl, removeBtnEl) {
        inputEl.addEventListener('change', () => {
            if (inputEl.files && inputEl.files[0]) {
                nameEl.textContent = inputEl.files[0].name;
                previewEl.style.display = 'flex';
                dropzoneEl.classList.add('active');
            }
        });

        ['dragenter', 'dragover'].forEach(ev => {
            dropzoneEl.addEventListener(ev, e => {
                e.preventDefault(); e.stopPropagation();
                dropzoneEl.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(ev => {
            dropzoneEl.addEventListener(ev, e => {
                e.preventDefault(); e.stopPropagation();
                dropzoneEl.classList.remove('dragover');
            });
        });

        dropzoneEl.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                inputEl.files = files;
                nameEl.textContent = files[0].name;
                previewEl.style.display = 'flex';
                dropzoneEl.classList.add('active');
            }
        });

        removeBtnEl.addEventListener('click', e => {
            e.stopPropagation();
            inputEl.value = '';
            previewEl.style.display = 'none';
            dropzoneEl.classList.remove('active');
        });
    }

    // -----------------------------------------------------------------------
    // Alertas
    // -----------------------------------------------------------------------
    function mostrarErro(msg) {
        alertBox.textContent = msg;
        alertBox.className = 'alert alert-error';
        alertBox.style.display = 'block';
    }
    function ocultarErro() {
        alertBox.style.display = 'none';
        alertBox.textContent = '';
    }

    // -----------------------------------------------------------------------
    // Gerar Ata — chamada ao backend
    // -----------------------------------------------------------------------
    btnGerar.addEventListener('click', async () => {
        ocultarErro();

        const temFoto  = inputFoto.files  && inputFoto.files.length  > 0;
        const temAudio = inputAudio.files && inputAudio.files.length > 0;

        if (!temFoto && !temAudio) {
            mostrarErro('Selecione pelo menos um arquivo (Foto das anotações ou Áudio da reunião).');
            return;
        }

        const formData = new FormData();
        if (temFoto)  formData.append('foto',  inputFoto.files[0]);
        if (temAudio) formData.append('audio', inputAudio.files[0]);

        setLoadingState(true);

        try {
            const response = await fetch('/api/gerar-ata', { method: 'POST', body: formData });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Ocorreu um erro ao processar a ata de reunião.');
            }

            ataGeradaTexto = data.ata;
            renderizarAta(ataGeradaTexto);
            resultCard.style.display = 'flex';
            resultCard.scrollIntoView({ behavior: 'smooth' });

        } catch (err) {
            mostrarErro(err.message || 'Falha de comunicação com o servidor.');
        } finally {
            setLoadingState(false);
        }
    });

    function setLoadingState(isLoading) {
        btnGerar.disabled   = isLoading;
        btnText.textContent = isLoading ? 'Processando com AtaGenius AI...' : '⚡ Gerar Ata com AtaGenius';
        spinner.style.display = isLoading ? 'inline-block' : 'none';
    }

    // -----------------------------------------------------------------------
    // Renderização: Markdown → HTML
    // -----------------------------------------------------------------------
    function renderizarAta(markdown) {
        let html = markdown
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Blockquotes (> texto)
        html = html.replace(/^&gt;\s?(.*$)/gim, '<blockquote>$1</blockquote>');

        // Cabeçalhos
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim,  '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim,   '<h1>$1</h1>');

        // Negrito e itálico
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g,     '<em>$1</em>');

        // Listas não-ordenadas
        html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

        // Listas ordenadas
        html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');

        // Separador horizontal
        html = html.replace(/^---$/gim, '<hr>');

        // Tabelas Markdown
        html = converterTabelaMarkdown(html);

        // Quebras de linha → <br> (linhas que não são tags HTML)
        html = html.replace(/\n(?!<[a-z])/g, '<br>');

        resultBody.innerHTML = html;
    }

    function converterTabelaMarkdown(html) {
        // Detecta blocos de tabela: linhas separadas por |
        return html.replace(
            /((?:\|.+\|\n?)+)/g,
            (bloco) => {
                const linhas = bloco.trim().split('\n').filter(l => l.trim());
                if (linhas.length < 2) return bloco;

                let tabelaHtml = '<table>';
                linhas.forEach((linha, i) => {
                    // Linha separadora (|---|---|) — pula
                    if (/^\|[\s\-:|]+\|/.test(linha)) return;

                    const celulas = linha.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                    const tag = i === 0 ? 'th' : 'td';
                    tabelaHtml += '<tr>' + celulas.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
                });
                tabelaHtml += '</table>';
                return tabelaHtml;
            }
        );
    }

    // -----------------------------------------------------------------------
    // Toolbar — Copiar Texto
    // -----------------------------------------------------------------------
    if (btnCopiar) {
        btnCopiar.addEventListener('click', async () => {
            if (!ataGeradaTexto) return;
            try {
                await navigator.clipboard.writeText(ataGeradaTexto);
                btnCopiar.textContent = '✅ Copiado!';
                btnCopiar.classList.add('export-btn--success');
                setTimeout(() => {
                    btnCopiar.textContent = '📋 Copiar Texto';
                    btnCopiar.classList.remove('export-btn--success');
                }, 2200);
            } catch (err) {
                console.error('Erro ao copiar texto:', err);
            }
        });
    }

    // -----------------------------------------------------------------------
    // Toolbar — Imprimir / Salvar PDF
    // -----------------------------------------------------------------------
    if (btnImprimir) {
        btnImprimir.addEventListener('click', () => window.print());
    }

    // -----------------------------------------------------------------------
    // Toolbar — Baixar em Word (.doc)
    // -----------------------------------------------------------------------
    if (btnWord) {
        btnWord.addEventListener('click', () => {
            if (!ataGeradaTexto) return;

            const htmlConteudo = resultBody.innerHTML;
            const docHtml = `
<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <meta name="ProgId" content="Word.Document">
  <meta name="Generator" content="AtaGenius">
  <style>
    body  { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; margin: 2.5cm; }
    h1    { font-size: 14pt; text-align: center; margin-bottom: 12pt; }
    h2    { font-size: 12pt; font-weight: bold; margin-top: 10pt; }
    h3    { font-size: 11pt; font-weight: bold; }
    table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
    th, td{ border: 1px solid #000; padding: 4pt 6pt; font-size: 10pt; }
    th    { background-color: #e0e0e0; font-weight: bold; }
    hr    { border: none; border-top: 1px solid #000; margin: 12pt 0; }
    blockquote { border-left: 3px solid #999; padding-left: 10pt; color: #555; }
  </style>
</head>
<body>${htmlConteudo}</body>
</html>`;

            const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword' });
            const url  = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href     = url;
            link.download = 'Ata_Notarial_AtaGenius.doc';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    }

    // -----------------------------------------------------------------------
    // Toolbar — Nova Ata
    // -----------------------------------------------------------------------
    if (btnNovaAta) {
        btnNovaAta.addEventListener('click', () => {
            resultCard.style.display = 'none';

            inputFoto.value  = '';
            inputAudio.value = '';
            previewFoto.style.display  = 'none';
            previewAudio.style.display = 'none';
            dropzoneFoto.classList.remove('active');
            dropzoneAudio.classList.remove('active');

            ataGeradaTexto       = '';
            resultBody.innerHTML = '';
            ocultarErro();

            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});
