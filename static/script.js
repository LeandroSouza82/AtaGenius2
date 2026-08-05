import { GravadorAssembleia } from '/static/gravador.js';

document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------------
    // Referências ao DOM
    // -----------------------------------------------------------------------
    const inputFoto          = document.getElementById('inputFoto');
    const dropzoneFoto       = document.getElementById('dropzoneFoto');
    const previewFotoCount   = document.getElementById('previewFotoCount');
    const contadorFotos      = document.getElementById('contadorFotos');
    const btnLimparFotos     = document.getElementById('btnLimparFotos');
    const galeriaFotos       = document.getElementById('galeriaFotos');

    const inputAudio         = document.getElementById('inputAudio');
    const dropzoneAudio      = document.getElementById('dropzoneAudio');
    const previewAudio       = document.getElementById('previewAudio');
    const nomeAudio          = document.getElementById('nomeAudio');
    const btnRemoverAudio    = document.getElementById('btnRemoverAudio');

    const btnGravar          = document.getElementById('btnGravar');
    const gravarLabel        = document.getElementById('gravarLabel');
    const gravarTimer        = document.getElementById('gravarTimer');
    const gravarStatus       = document.getElementById('gravarStatus');

    const btnGerar   = document.getElementById('btnGerar');
    const btnText    = btnGerar.querySelector('.btn-text');
    const spinner    = btnGerar.querySelector('.spinner');
    const alertBox   = document.getElementById('alertBox');
    const resultCard = document.getElementById('resultCard');
    const resultBody = document.getElementById('resultBody');

    const btnCopiar   = document.getElementById('btn-copiar');
    const btnWord     = document.getElementById('btn-word');
    const btnImprimir = document.getElementById('btn-imprimir');
    const btnNovaAta  = document.getElementById('btn-nova-ata');

    // -----------------------------------------------------------------------
    // Estado local: lista acumulada de arquivos de imagem
    // -----------------------------------------------------------------------
    /** @type {File[]} */
    let listaImagens   = [];
    let ataGeradaTexto = '';

    /** @type {Blob|null} Blob do audio gravado pelo GravadorAssembleia */
    let audioGravado     = null;
    let nomeAudioGravado = '';

    // Instancia do gravador (singleton reutilizavel)
    const gravador = new GravadorAssembleia({
        onPronto(blob, nome, duracaoSeg) {
            audioGravado     = blob;
            nomeAudioGravado = nome;
            const min = String(Math.floor(duracaoSeg / 60)).padStart(2, '0');
            const seg = String(duracaoSeg % 60).padStart(2, '0');
            gravarStatus.textContent = `Pronto: ${nome} (${min}:${seg})`;
            gravarStatus.className   = 'gravar-status ok';
            gravarTimer.style.display = 'none';
        },
        onTick(seg) {
            const min = String(Math.floor(seg / 60)).padStart(2, '0');
            const s   = String(seg % 60).padStart(2, '0');
            gravarTimer.textContent = `${min}:${s}`;
        },
        onErro(msg) {
            gravarStatus.textContent = msg;
            gravarStatus.className   = 'gravar-status';
            gravarTimer.style.display = 'none';
            btnGravar.classList.remove('gravando');
            gravarLabel.textContent = 'Gravar Reunião';
        },
    });

    // Handler do botao Gravar / Parar
    btnGravar.addEventListener('click', async () => {
        if (!gravador.gravando) {
            // --- INICIAR ---
            audioGravado = null;
            gravarStatus.textContent = 'Aguardando microfone...';
            gravarStatus.className   = 'gravar-status';
            await gravador.iniciar();
            if (gravador.gravando) {
                btnGravar.classList.add('gravando');
                gravarLabel.textContent  = 'Parar Gravação';
                gravarTimer.style.display = 'inline';
                gravarTimer.textContent  = '00:00';
                gravarStatus.textContent = 'Gravando... pode minimizar o app.';
            }
        } else {
            // --- PARAR ---
            gravador.parar();
            btnGravar.classList.remove('gravando');
            gravarLabel.textContent = 'Gravar Reunião';
        }
    });


    // -----------------------------------------------------------------------
    // Utilitários de alerta
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
    // Galeria de miniaturas das imagens acumuladas
    // -----------------------------------------------------------------------
    function atualizarGaleria() {
        galeriaFotos.innerHTML = '';

        if (listaImagens.length === 0) {
            galeriaFotos.style.display = 'none';
            previewFotoCount.style.display = 'none';
            dropzoneFoto.classList.remove('active');
            return;
        }

        // Contador no cabeçalho da dropzone
        const s = listaImagens.length === 1 ? '' : 's';
        contadorFotos.textContent = `${listaImagens.length} imagem${s} selecionada${s}`;
        previewFotoCount.style.display = 'flex';
        dropzoneFoto.classList.add('active');
        galeriaFotos.style.display = 'flex';

        listaImagens.forEach((file, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'thumb-wrapper';

            const img = document.createElement('img');
            img.className = 'thumb-img';
            img.alt = file.name;
            img.src = URL.createObjectURL(file);
            // Libera memória quando a imagem for removida do DOM
            img.onload = () => URL.revokeObjectURL(img.src);

            const label = document.createElement('span');
            label.className = 'thumb-label';
            label.textContent = file.name.length > 16
                ? file.name.slice(0, 13) + '…'
                : file.name;

            const btnRemove = document.createElement('button');
            btnRemove.className = 'thumb-remove';
            btnRemove.title = 'Remover esta imagem';
            btnRemove.innerHTML = '&times;';
            btnRemove.addEventListener('click', (e) => {
                e.stopPropagation();
                listaImagens.splice(index, 1);
                // Limpa o input para que os mesmos arquivos possam ser
                // re-selecionados caso o usuário queira.
                inputFoto.value = '';
                atualizarGaleria();
            });

            wrapper.appendChild(img);
            wrapper.appendChild(label);
            wrapper.appendChild(btnRemove);
            galeriaFotos.appendChild(wrapper);
        });
    }

    // -----------------------------------------------------------------------
    // Acumulador de imagens — lê FileList e adiciona à lista sem duplicatas
    // -----------------------------------------------------------------------
    function acumularImagens(fileList) {
        const nomeExistentes = new Set(listaImagens.map(f => f.name + f.size));
        Array.from(fileList).forEach(file => {
            const chave = file.name + file.size;
            if (!nomeExistentes.has(chave)) {
                listaImagens.push(file);
                nomeExistentes.add(chave);
            }
        });
        atualizarGaleria();
    }

    // -----------------------------------------------------------------------
    // Handlers da Dropzone de Foto
    // -----------------------------------------------------------------------
    inputFoto.addEventListener('change', () => {
        if (inputFoto.files && inputFoto.files.length > 0) {
            acumularImagens(inputFoto.files);
        }
    });

    ['dragenter', 'dragover'].forEach(ev => {
        dropzoneFoto.addEventListener(ev, e => {
            e.preventDefault();
            e.stopPropagation();
            dropzoneFoto.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(ev => {
        dropzoneFoto.addEventListener(ev, e => {
            e.preventDefault();
            e.stopPropagation();
            dropzoneFoto.classList.remove('dragover');
        });
    });

    dropzoneFoto.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            acumularImagens(files);
        }
    });

    // Limpar toda a galeria
    btnLimparFotos.addEventListener('click', e => {
        e.stopPropagation();
        listaImagens = [];
        inputFoto.value = '';
        atualizarGaleria();
    });

    // -----------------------------------------------------------------------
    // Handler da Dropzone de Áudio (sem alteração de comportamento)
    // -----------------------------------------------------------------------
    function setupAudioHandler() {
        inputAudio.addEventListener('change', () => {
            if (inputAudio.files && inputAudio.files[0]) {
                nomeAudio.textContent = inputAudio.files[0].name;
                previewAudio.style.display = 'flex';
                dropzoneAudio.classList.add('active');
            }
        });

        ['dragenter', 'dragover'].forEach(ev => {
            dropzoneAudio.addEventListener(ev, e => {
                e.preventDefault();
                e.stopPropagation();
                dropzoneAudio.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(ev => {
            dropzoneAudio.addEventListener(ev, e => {
                e.preventDefault();
                e.stopPropagation();
                dropzoneAudio.classList.remove('dragover');
            });
        });

        dropzoneAudio.addEventListener('drop', e => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                inputAudio.files = files;
                nomeAudio.textContent = files[0].name;
                previewAudio.style.display = 'flex';
                dropzoneAudio.classList.add('active');
            }
        });

        btnRemoverAudio.addEventListener('click', e => {
            e.stopPropagation();
            inputAudio.value = '';
            previewAudio.style.display = 'none';
            dropzoneAudio.classList.remove('active');
        });
    }
    setupAudioHandler();

    // -----------------------------------------------------------------------
    // Gerar Ata — chamada ao backend
    // -----------------------------------------------------------------------
    btnGerar.addEventListener('click', async () => {
        ocultarErro();

        const temFotos = listaImagens.length > 0;
        const temAudioArquivo = inputAudio.files && inputAudio.files.length > 0;
        const temAudioGravado = audioGravado !== null;
        const temAudio = temAudioArquivo || temAudioGravado;

        if (!temFotos && !temAudio) {
            mostrarErro('Selecione pelo menos uma imagem das anotações ou o áudio da reunião.');
            return;
        }

        // Monta FormData com a chave correta "imagens" (plural) para o FastAPI
        const formData = new FormData();
        listaImagens.forEach(img => formData.append('imagens', img));
        if (temAudioArquivo) formData.append('audio', inputAudio.files[0]);
        else if (temAudioGravado) formData.append('audio', new File([audioGravado], nomeAudioGravado, { type: audioGravado.type }));

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
        btnGerar.disabled = isLoading;
        btnText.textContent = isLoading
            ? 'Processando com AtaGenius AI...'
            : '⚡ Gerar Ata com AtaGenius';
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

        // Quebras de linha → <br>
        html = html.replace(/\n(?!<[a-z])/g, '<br>');

        resultBody.innerHTML = html;
    }

    function converterTabelaMarkdown(html) {
        return html.replace(
            /((?:\|.+\|\n?)+)/g,
            (bloco) => {
                const linhas = bloco.trim().split('\n').filter(l => l.trim());
                if (linhas.length < 2) return bloco;

                let tabelaHtml = '<table>';
                linhas.forEach((linha, i) => {
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

            // Limpa estado de imagens
            listaImagens = [];
            inputFoto.value = '';
            atualizarGaleria();

            // Limpa audio (arquivo e gravado)
            inputAudio.value = '';
            previewAudio.style.display = 'none';
            dropzoneAudio.classList.remove('active');
            audioGravado     = null;
            nomeAudioGravado = '';
            gravarStatus.textContent = '';
            gravarStatus.className   = 'gravar-status';
            gravarTimer.style.display = 'none';
            if (gravador.gravando) gravador.cancelar();
            btnGravar.classList.remove('gravando');
            gravarLabel.textContent = 'Gravar Reunião';

            ataGeradaTexto = '';
            resultBody.innerHTML = '';
            ocultarErro();

            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});
