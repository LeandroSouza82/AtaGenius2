/**
 * GravadorAssembleia — gravacao de audio via MediaRecorder (Web API)
 *
 * Codec alvo: audio/webm;codecs=opus @ ~28 kbps  (formato mais leve suportado
 * nativamente por Chrome, Edge e Firefox sem bibliotecas externas).
 * A gravacao continua em background quando o usuario minimiza o browser,
 * pois roda sobre a MediaStream do sistema operacional.
 *
 * Uso:
 *   const gravador = new GravadorAssembleia({ onPronto, onTick, onErro });
 *   gravador.iniciar();
 *   gravador.parar();   // dispara onPronto(blob, nomeArquivo, duracaoSeg)
 *   gravador.cancelar();
 */

'use strict';

export class GravadorAssembleia {
    /**
     * @param {object} opcoes
     * @param {function(Blob, string, number): void} opcoes.onPronto
     *   Chamado com (blob, nomeArquivo, duracaoSeg) ao parar a gravacao.
     * @param {function(number): void} [opcoes.onTick]
     *   Chamado a cada segundo com o total de segundos gravados.
     * @param {function(string): void} [opcoes.onErro]
     *   Chamado com mensagem de erro se algo falhar.
     */
    constructor({ onPronto, onTick = null, onErro = null } = {}) {
        this._onPronto = onPronto;
        this._onTick   = onTick;
        this._onErro   = onErro;

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

        this._mediaRecorder.onstop = () => {
            this._pararTimer();
            this._liberarStream();

            const extensao = this._mimeType.includes('ogg') ? 'ogg' : 'webm';
            const blob = new Blob(this._chunks, { type: this._mimeType || 'audio/webm' });
            const nome = `reuniao_${_timestampArquivo()}.${extensao}`;
            if (this._onPronto) this._onPronto(blob, nome, this._segundos);

            this._chunks   = [];
            this.gravando  = false;
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
