/**
 * GravadorAssembleia — gravacao de audio via MediaRecorder (Web API)
 *
 * Pipeline de otimizacao client-side (executada antes de onPronto):
 *   1. Decode do blob gravado (webm/ogg) via Web Audio API
 *   2. Downsample para mono 16 kHz com OfflineAudioContext
 *   3. Encode para WAV PCM 16-bit (leve, amplamente suportado por STT/LLM)
 *   4. Fracionamento automatico em blocos de MAX_BLOCO_SEGUNDOS quando
 *      a duracao ultrapassar LIMIAR_FRACIONAMENTO_SEGUNDOS
 *
 * Codec de gravacao alvo: audio/webm;codecs=opus @ ~28 kbps (Chrome/Edge/Firefox)
 * A gravacao continua em background ao minimizar o browser pois usa MediaStream do OS.
 *
 * Uso:
 *   const gravador = new GravadorAssembleia({ onPronto, onTick, onErro, onOtimizando });
 *   gravador.iniciar();
 *   gravador.parar();   // dispara onPronto(blocos, nomeBase, duracaoSeg)
 *   gravador.cancelar();
 */

'use strict';

// ---------------------------------------------------------------------------
// Constantes de otimizacao
// ---------------------------------------------------------------------------

/** Taxa de amostragem alvo para reconhecimento de voz (Hz) */
const SAMPLE_RATE_ALVO = 16000;

/** Limite de duracao (segundos) acima do qual o audio e fracionado */
const LIMIAR_FRACIONAMENTO_SEGUNDOS = 600; // 10 minutos

/** Tamanho de cada bloco ao fracionar (segundos) */
const MAX_BLOCO_SEGUNDOS = 600; // 10 minutos por bloco

// ---------------------------------------------------------------------------
// OtimizadorAudio — pipeline client-side de otimizacao de audio
// ---------------------------------------------------------------------------

/**
 * Converte um Blob de audio gravado para um ou mais Blobs WAV otimizados:
 *   - Mono, 16 kHz, PCM 16-bit
 *   - Fracionado em blocos de MAX_BLOCO_SEGUNDOS se necessario
 *
 * @param {Blob}     blob          Blob de audio original (webm, ogg, etc.)
 * @param {number}   duracaoSeg    Duracao total gravada em segundos
 * @param {function} [onProgresso] Callback opcional com mensagem de progresso
 * @returns {Promise<Blob[]>}      Array de Blobs WAV (1 item se nao fracionado)
 */
async function otimizarAudio(blob, duracaoSeg, onProgresso) {
    const reportar = (msg) => { if (onProgresso) onProgresso(msg); };

    reportar('Decodificando audio...');

    // 1. Le os bytes brutos do blob gravado
    const arrayBuffer = await blob.arrayBuffer();

    // 2. Decodifica com a AudioContext padrao do browser
    let audioBuffer;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        await ctx.close();
    } catch (err) {
        // Se a decodificacao falhar (formato nao suportado pelo browser),
        // devolve o blob original sem fracionamento para nao bloquear o fluxo
        console.warn('[OtimizadorAudio] decodeAudioData falhou, enviando original:', err);
        return [blob];
    }

    const totalAmostras = audioBuffer.length;
    const srOriginal    = audioBuffer.sampleRate;

    // 3. Decide se fraciona
    const deveFracionar = duracaoSeg > LIMIAR_FRACIONAMENTO_SEGUNDOS;
    const totalBlocos   = deveFracionar
        ? Math.ceil(duracaoSeg / MAX_BLOCO_SEGUNDOS)
        : 1;

    const blocos = [];

    for (let i = 0; i < totalBlocos; i++) {
        const inicioSeg = i * MAX_BLOCO_SEGUNDOS;
        const fimSeg    = Math.min(inicioSeg + MAX_BLOCO_SEGUNDOS, duracaoSeg);

        if (totalBlocos > 1) {
            reportar(`Processando bloco ${i + 1} de ${totalBlocos} (${_fmtTempo(inicioSeg)}–${_fmtTempo(fimSeg)})...`);
        } else {
            reportar('Convertendo para mono 16 kHz...');
        }

        // 4. Extrai a fatia do AudioBuffer original
        const inicioAmostra = Math.floor((inicioSeg / duracaoSeg) * totalAmostras);
        const fimAmostra    = Math.floor((fimSeg   / duracaoSeg) * totalAmostras);
        const qtdAmostras   = fimAmostra - inicioAmostra;

        // 5. Reamostrage via OfflineAudioContext (mono, 16 kHz)
        const duracaoBloco     = fimSeg - inicioSeg;
        const amostrasDestino  = Math.ceil(duracaoBloco * SAMPLE_RATE_ALVO);
        const offCtx = new OfflineAudioContext(1, amostrasDestino, SAMPLE_RATE_ALVO);

        // Cria um buffer temporario com a fatia de audio (mistura todos os canais -> mono)
        const tmpBuffer = new AudioBuffer({
            numberOfChannels: 1,
            length: qtdAmostras,
            sampleRate: srOriginal,
        });
        const canal = tmpBuffer.getChannelData(0);
        const nCanais = audioBuffer.numberOfChannels;
        for (let a = 0; a < qtdAmostras; a++) {
            let soma = 0;
            for (let c = 0; c < nCanais; c++) {
                soma += audioBuffer.getChannelData(c)[inicioAmostra + a];
            }
            canal[a] = soma / nCanais;
        }

        const fonte = offCtx.createBufferSource();
        fonte.buffer = tmpBuffer;
        fonte.connect(offCtx.destination);
        fonte.start(0);

        const bufferResampleado = await offCtx.startRendering();

        // 6. Encode o AudioBuffer para WAV PCM 16-bit
        reportar(totalBlocos > 1
            ? `Comprimindo bloco ${i + 1} de ${totalBlocos}...`
            : 'Comprimindo audio...');

        const wavBlob = _audioBufferParaWav(bufferResampleado);
        blocos.push(wavBlob);
    }

    reportar('');
    return blocos;
}

/**
 * Encoda um AudioBuffer mono para WAV PCM 16-bit.
 * Gera arquivos leves (~32 KB/s a 16kHz mono), compatíveis com
 * qualquer serviço de STT e com a API Gemini.
 *
 * @param {AudioBuffer} audioBuffer
 * @returns {Blob}
 */
function _audioBufferParaWav(audioBuffer) {
    const numCanais   = 1; // sempre mono apos o pipeline
    const sr          = audioBuffer.sampleRate;
    const amostras    = audioBuffer.getChannelData(0);
    const numAmostras = amostras.length;
    const bytesAmostra = 2; // 16-bit PCM

    const bufferTotal = 44 + numAmostras * bytesAmostra;
    const view        = new DataView(new ArrayBuffer(bufferTotal));

    // Cabecalho RIFF/WAVE
    const escreverStr = (off, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    escreverStr(0,  'RIFF');
    view.setUint32(4,  36 + numAmostras * bytesAmostra, true);
    escreverStr(8,  'WAVE');
    escreverStr(12, 'fmt ');
    view.setUint32(16, 16, true);           // tamanho do chunk fmt
    view.setUint16(20,  1, true);           // PCM
    view.setUint16(22, numCanais, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCanais * bytesAmostra, true); // byte rate
    view.setUint16(32, numCanais * bytesAmostra, true);      // block align
    view.setUint16(34, bytesAmostra * 8, true);              // bits por amostra
    escreverStr(36, 'data');
    view.setUint32(40, numAmostras * bytesAmostra, true);

    // Amostras PCM 16-bit com clamp
    let off = 44;
    for (let i = 0; i < numAmostras; i++, off += 2) {
        const s = Math.max(-1, Math.min(1, amostras[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view.buffer], { type: 'audio/wav' });
}

/**
 * Formata segundos em MM:SS.
 * @param {number} seg
 * @returns {string}
 */
function _fmtTempo(seg) {
    const m = String(Math.floor(seg / 60)).padStart(2, '0');
    const s = String(Math.floor(seg % 60)).padStart(2, '0');
    return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// GravadorAssembleia
// ---------------------------------------------------------------------------

export class GravadorAssembleia {
    /**
     * @param {object}   opcoes
     * @param {function(Blob[], string, number): void} opcoes.onPronto
     *   Chamado com (blocos[], nomeBase, duracaoSeg) apos a otimizacao.
     *   blocos e um array de Blobs WAV (1 item para gravacoes curtas,
     *   varios itens para reunioes longas fracionadas).
     * @param {function(number): void}  [opcoes.onTick]
     *   Chamado a cada segundo com o total de segundos gravados.
     * @param {function(string): void}  [opcoes.onErro]
     *   Chamado com mensagem de erro se algo falhar.
     * @param {function(string): void}  [opcoes.onOtimizando]
     *   Chamado com mensagens de progresso durante a otimizacao.
     */
    constructor({ onPronto, onTick = null, onErro = null, onOtimizando = null } = {}) {
        this._onPronto     = onPronto;
        this._onTick       = onTick;
        this._onErro       = onErro;
        this._onOtimizando = onOtimizando;

        this._mediaRecorder = null;
        this._chunks        = [];
        this._stream        = null;
        this._timerID       = null;
        this._segundos      = 0;
        this._mimeType      = '';
        this.gravando       = false;
    }

    // ------------------------------------------------------------------
    // Escolhe o MIME mais compacto suportado pelo browser
    // ------------------------------------------------------------------
    static _escolherMime() {
        const candidatos = [
            'audio/webm;codecs=opus',   // Chrome, Edge, Firefox
            'audio/ogg;codecs=opus',    // Firefox fallback
            'audio/webm',               // Safari 17+
        ];
        for (const tipo of candidatos) {
            if (MediaRecorder.isTypeSupported(tipo)) return tipo;
        }
        return '';  // deixa o browser escolher
    }

    // ------------------------------------------------------------------
    // Iniciar gravacao
    // ------------------------------------------------------------------
    async iniciar() {
        if (this.gravando) return;

        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,        // mono
                    sampleRate: 16000,      // 16 kHz — suficiente para voz
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
        } catch (err) {
            const msg = err.name === 'NotAllowedError'
                ? 'Permissao de microfone negada. Habilite o acesso ao microfone e tente novamente.'
                : `Erro ao acessar o microfone: ${err.message}`;
            if (this._onErro) this._onErro(msg);
            return;
        }

        this._mimeType = GravadorAssembleia._escolherMime();
        this._chunks   = [];
        this._segundos = 0;

        const opcoes = { audioBitsPerSecond: 28000 };
        if (this._mimeType) opcoes.mimeType = this._mimeType;

        this._mediaRecorder = new MediaRecorder(this._stream, opcoes);

        this._mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) this._chunks.push(e.data);
        };

                        this._mediaRecorder.onstop = async () => {
            this._pararTimer();
            this._liberarStream();

            const duracaoSeg = this._segundos;
            const mimeType   = this._mimeType || 'audio/webm';
            const blobBruto  = new Blob(this._chunks, { type: mimeType });
            const nomeBase   = `reuniao_${_timestampArquivo()}`;

            this._chunks  = [];
            this.gravando = false;

            // ----------------------------------------------------------
            // Pipeline de otimizacao client-side (assíncrona)
            // Converte o audio bruto para WAV mono 16 kHz e fraciona
            // automaticamente reunioes longas em blocos de 10 minutos.
            // ----------------------------------------------------------
            let blocosFinais;
            try {
                blocosFinais = await otimizarAudio(
                    blobBruto,
                    duracaoSeg,
                    (msg) => { if (this._onOtimizando) this._onOtimizando(msg); }
                );
            } catch (err) {
                // Falha inesperada na otimizacao: entrega o blob original
                // em um array de um elemento para nao bloquear o usuario
                console.warn('[GravadorAssembleia] otimizacao falhou, usando original:', err);
                blocosFinais = [blobBruto];
            }

            if (this._onPronto) this._onPronto(blocosFinais, nomeBase, duracaoSeg);
        };

        this._mediaRecorder.onerror = (e) => {
            if (this._onErro) this._onErro(`Erro na gravacao: ${e.error?.message ?? 'desconhecido'}`);
            this._pararTimer();
            this._liberarStream();
            this.gravando = false;
        };

        // Coleta chunks a cada 250 ms para nao perder dados se o browser fechar
        this._mediaRecorder.start(250);
        this.gravando = true;
        this._iniciarTimer();
    }

    // ------------------------------------------------------------------
    // Parar e obter o blob finalizado
    // ------------------------------------------------------------------
    parar() {
        if (!this.gravando || !this._mediaRecorder) return;
        this._mediaRecorder.stop();
        // onstop cuidara do restante
    }

    // ------------------------------------------------------------------
    // Cancelar sem salvar
    // ------------------------------------------------------------------
    cancelar() {
        if (!this._mediaRecorder) return;
        this._mediaRecorder.ondataavailable = null;
        this._mediaRecorder.onstop = null;
        if (this._mediaRecorder.state !== 'inactive') this._mediaRecorder.stop();
        this._pararTimer();
        this._liberarStream();
        this._chunks  = [];
        this.gravando = false;
    }

    // ------------------------------------------------------------------
    // Internos
    // ------------------------------------------------------------------
    _iniciarTimer() {
        this._timerID = setInterval(() => {
            this._segundos++;
            if (this._onTick) this._onTick(this._segundos);
        }, 1000);
    }

    _pararTimer() {
        clearInterval(this._timerID);
        this._timerID = null;
    }

    _liberarStream() {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
    }
}

// ------------------------------------------------------------------
// Utilidade interna: timestamp para nome do arquivo
// ------------------------------------------------------------------
function _timestampArquivo() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
