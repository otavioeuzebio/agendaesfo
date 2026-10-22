/**
 * Interpretador da Adição Rápida.
 *
 * Transforma uma linha livre em uma demanda estruturada, para cadastrar em
 * menos de 5 segundos. Sintaxe aceita (tudo opcional, em qualquer ordem):
 *
 *   Guarda amanhã 7h às 7h @Portão principal !!!
 *   Prova de Direito Penal sex 8h #acad
 *   Entregar trabalho de Ética 30/10 !!
 *   Requerimento de dispensa hoje 14h30 #adm
 *
 *   data ....... hoje | amanhã | depois de amanhã | seg..dom | 25/10 | 25/10/2026 | dia 25
 *   hora ....... 7h | 07h30 | 7:30 | às 19h  ·  intervalo: 7h às 19h | 7h-19h
 *                (fim menor ou igual ao início = termina no dia seguinte, ex.: guarda de 24h)
 *   local ...... @texto (até o próximo marcador)
 *   prioridade . !!! crítico · !! importante · ! rotineiro
 *   categoria .. #op #escala · #acad · #adm · #pes
 *
 * Sem dependências: é uma função pura e testável fora do app.
 */
import { lembretesPadrao, SUBTIPOS } from './catalog.js';
/** Remove acentos preservando o comprimento (1 caractere → 1 caractere). */
const semAcento = (s) => Array.from(s)
    .map((c) => c.normalize('NFD')[0])
    .join('')
    .toLowerCase();
const DIAS_SEMANA = [
    [/\bdom(ingo)?\b/, 0],
    [/\bseg(unda)?(-feira)?\b/, 1],
    [/\bterca(-feira)?\b/, 2],
    [/\bqua(rta)?(-feira)?\b/, 3],
    [/\bqui(nta)?(-feira)?\b/, 4],
    [/\bsex(ta)?(-feira)?\b/, 5],
    [/\bsab(ado)?\b/, 6],
];
const PALAVRAS_SUBTIPO = [
    [/\boficial de dia\b|\bof(\.)? dia\b/, 'oficial_dia'],
    [/\bposto (ii|2)\b/, 'sentinela_posto2'],
    [/\bsentinela\b/, 'sentinela_guarda'],
    [/\bescala especial\b|\bespecial\b/, 'escala_especial'],
    [/\bguarda\b|\bplantao\b/, 'guarda'],
    [/\bestagio\b|\bcpu\b|\bpatrulh/, 'estagio_cpu'],
    [/\bescala\b|\bservico\b|\bpermanencia\b/, 'escala_outro'],
    [/\bprova\b|\bavaliacao\b|\bverificacao\b|\bvc\b|\bvf\b|\bteste\b/, 'prova'],
    [/\btrabalho\b|\bentrega(r)?\b|\brelatorio\b|\bartigo\b|\btcc\b/, 'trabalho'],
    [/\bseminario\b|\bapresentacao\b/, 'seminario'],
    [/\baula\b|\binstrucao\b|\btreinamento\b|\btiro\b/, 'aula'],
    [/\bformatura\b|\bdesfile\b|\bsolenidade\b|\bparada\b/, 'formatura'],
    [/\brequerimento\b|\bdocumento\b|\boficio\b|\bparte\b|\bassinar\b/, 'documento'],
];
const TAG_CATEGORIA = {
    op: 'operacional', escala: 'operacional', operacional: 'operacional',
    acad: 'academico', academico: 'academico', estudo: 'academico',
    adm: 'administrativo', administrativo: 'administrativo',
    pes: 'pessoal', pessoal: 'pessoal',
};
const SUBTIPO_PADRAO_DA_CATEGORIA = {
    operacional: 'escala_outro',
    academico: 'aula',
    administrativo: 'documento',
    pessoal: 'pessoal',
};
function prioridadePadrao(subtipo) {
    const cat = SUBTIPOS[subtipo].categoria;
    if (cat === 'operacional' || subtipo === 'prova')
        return 'critico';
    if (subtipo === 'trabalho' || subtipo === 'seminario' || subtipo === 'formatura')
        return 'importante';
    return 'rotineiro';
}
const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export function interpretarRapido(texto, agora = new Date()) {
    const original = texto.trim();
    const norm = semAcento(original);
    const remover = [];
    const reconhecido = [];
    const marcar = (m, grupo = 0) => {
        if (!m)
            return;
        const ini = m.index + (grupo ? m[0].indexOf(m[grupo]) : 0);
        remover.push([ini, ini + m[grupo].length]);
    };
    // ---- local: @texto até o próximo marcador (# ou !) ou fim
    let local = null;
    const mLocal = /@([^#!@]+)/.exec(norm);
    if (mLocal) {
        local = original.slice(mLocal.index + 1, mLocal.index + 1 + mLocal[1].length).trim() || null;
        marcar(mLocal);
    }
    // ---- prioridade explícita
    let prioridade = null;
    const mPri = /(^|\s)(!{1,3})(?=\s|$)/.exec(norm);
    if (mPri) {
        prioridade = mPri[2].length === 3 ? 'critico' : mPri[2].length === 2 ? 'importante' : 'rotineiro';
        marcar(mPri, 2);
    }
    // ---- categoria por hashtag
    let categoriaTag = null;
    const reTag = /#(\w+)/g;
    let mTag;
    while ((mTag = reTag.exec(norm))) {
        const c = TAG_CATEGORIA[mTag[1]];
        if (c)
            categoriaTag = c;
        marcar(mTag);
    }
    // ---- data
    const hoje = inicioDoDia(agora);
    let dia = null;
    let mData;
    if ((mData = /\bdepois de amanha\b/.exec(norm))) {
        dia = somaDias(hoje, 2);
        marcar(mData);
        reconhecido.push('Depois de amanhã');
    }
    else if ((mData = /\bamanha\b/.exec(norm))) {
        dia = somaDias(hoje, 1);
        marcar(mData);
        reconhecido.push('Amanhã');
    }
    else if ((mData = /\bhoje\b/.exec(norm))) {
        dia = hoje;
        marcar(mData);
        reconhecido.push('Hoje');
    }
    else if ((mData = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(norm))) {
        const d = +mData[1], m = +mData[2] - 1;
        let a = mData[3] ? +mData[3] : hoje.getFullYear();
        if (a < 100)
            a += 2000;
        let cand = new Date(a, m, d);
        if (!mData[3] && cand < hoje)
            cand = new Date(a + 1, m, d); // 05/01 digitado em dezembro → ano seguinte
        if (cand.getMonth() === m) {
            dia = cand;
            marcar(mData);
        }
    }
    else if ((mData = /\bdia (\d{1,2})\b/.exec(norm))) {
        const d = +mData[1];
        let cand = new Date(hoje.getFullYear(), hoje.getMonth(), d);
        if (cand < hoje)
            cand = new Date(hoje.getFullYear(), hoje.getMonth() + 1, d);
        if (cand.getDate() === d) {
            dia = cand;
            marcar(mData);
        }
    }
    else {
        for (const [re, wd] of DIAS_SEMANA) {
            // "(na|no|próxima) sexta" — o artigo/adjetivo também sai do título
            const m = new RegExp(`(?:\\b(?:na|no|proxim[ao]|nesta|neste)\\s+)?${re.source}`).exec(norm);
            if (m) {
                const delta = (wd - hoje.getDay() + 7) % 7;
                dia = somaDias(hoje, delta);
                marcar(m);
                break;
            }
        }
    }
    // ---- hora (e intervalo)
    const H = String.raw `(\d{1,2})(?:(?:h|:)(\d{2})?|h)`;
    let horaIni = null;
    let horaFim = null;
    const reIntervalo = new RegExp(String.raw `(?:\bas\s+|\bdas\s+)?\b${H}\s*(?:-|a|as|ate)\s*(?:as\s+)?${H}`);
    const reHora = new RegExp(String.raw `(?:\bas\s+)?\b${H}`);
    const mInt = reIntervalo.exec(norm);
    const valida = (h, m) => h < 24 && m < 60;
    if (mInt && valida(+mInt[1], +(mInt[2] ?? 0)) && valida(+mInt[3], +(mInt[4] ?? 0))) {
        horaIni = [+mInt[1], +(mInt[2] ?? 0)];
        horaFim = [+mInt[3], +(mInt[4] ?? 0)];
        marcar(mInt);
    }
    else {
        const mH = reHora.exec(norm);
        if (mH && valida(+mH[1], +(mH[2] ?? 0))) {
            horaIni = [+mH[1], +(mH[2] ?? 0)];
            marcar(mH);
        }
    }
    // ---- subtipo/categoria por palavra-chave (palavras continuam no título)
    let subtipo = null;
    for (const [re, st] of PALAVRAS_SUBTIPO) {
        if (re.test(norm) && (!categoriaTag || SUBTIPOS[st].categoria === categoriaTag)) {
            subtipo = st;
            break;
        }
    }
    if (!subtipo)
        subtipo = SUBTIPO_PADRAO_DA_CATEGORIA[categoriaTag ?? 'pessoal'];
    const categoria = categoriaTag ?? SUBTIPOS[subtipo].categoria;
    const pri = prioridade ?? prioridadePadrao(subtipo);
    // ---- monta datas
    const diaBase = dia ?? hoje;
    let inicio;
    let diaInteiro = false;
    if (horaIni) {
        inicio = new Date(diaBase.getFullYear(), diaBase.getMonth(), diaBase.getDate(), horaIni[0], horaIni[1]);
        // "guarda 7h" sem data, já passou das 7h → assume amanhã
        if (!dia && inicio.getTime() < agora.getTime())
            inicio = somaDias(inicio, 1), inicio.setHours(horaIni[0], horaIni[1]);
    }
    else {
        inicio = diaBase;
        diaInteiro = true;
    }
    let fim = null;
    if (horaFim) {
        fim = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), horaFim[0], horaFim[1]);
        if (fim <= inicio)
            fim = somaDias(fim, 1), fim.setHours(horaFim[0], horaFim[1]);
    }
    // ---- título = texto sem os marcadores reconhecidos
    remover.sort((a, b) => b[0] - a[0]);
    let titulo = original;
    for (const [a, b] of remover)
        titulo = titulo.slice(0, a) + ' ' + titulo.slice(b);
    titulo = titulo.replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
    titulo = titulo.replace(/^(de|do|da|em|no|na|as|às)\s+/i, '').replace(/\s+(de|do|da|em|no|na|as|às)$/i, '').trim();
    if (!titulo)
        titulo = SUBTIPOS[subtipo].rotulo;
    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
    // chips de confirmação
    const pad = (n) => String(n).padStart(2, '0');
    if (dia && !reconhecido.length)
        reconhecido.push(`${pad(dia.getDate())}/${pad(dia.getMonth() + 1)}`);
    if (horaIni)
        reconhecido.push(`${pad(horaIni[0])}:${pad(horaIni[1])}` + (horaFim ? ` → ${pad(horaFim[0])}:${pad(horaFim[1])}${fim && fim.getDate() !== inicio.getDate() ? ' (+1)' : ''}` : ''));
    if (local)
        reconhecido.push(`@ ${local}`);
    return {
        titulo,
        categoria,
        subtipo,
        prioridade: pri,
        inicioMs: inicio.getTime(),
        fimMs: fim ? fim.getTime() : null,
        diaInteiro,
        local,
        // Para "dia todo", o agendador ancora os lembretes às 08:00 do dia.
        lembretesMin: lembretesPadrao(subtipo, pri),
        reconhecido,
    };
}
