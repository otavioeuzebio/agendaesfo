/** Utilitários de data em pt-BR, sem dependências externas. */
export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const inicioDoDia = (d) => {
    const x = new Date(d);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
export const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const mesmoDia = (a, b) => inicioDoDia(a).getTime() === inicioDoDia(b).getTime();
const p2 = (n) => String(n).padStart(2, '0');
export const hhmm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const ddmm = (ms) => { const d = new Date(ms); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; };
export function rotuloDia(ms, agora = Date.now()) {
    const diff = Math.round((inicioDoDia(ms).getTime() - inicioDoDia(agora).getTime()) / 86400000);
    if (diff === 0)
        return 'Hoje';
    if (diff === 1)
        return 'Amanhã';
    if (diff === -1)
        return 'Ontem';
    const d = new Date(ms);
    return `${DIAS_CURTOS[d.getDay()]}, ${ddmm(ms)}`;
}
export function dataPorExtenso(ms) {
    const d = new Date(ms);
    const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    return `${dias[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`;
}
/** "3h 22m", "2d 4h", "45m 10s" (segundos só na última hora). */
export function contagem(msRestantes) {
    const s = Math.max(0, Math.floor(msRestantes / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
    if (d > 0)
        return `${d}d ${h}h`;
    if (h > 0)
        return `${h}h ${p2(m)}m`;
    return `${m}m ${p2(seg)}s`;
}
export const BLOCOS = [
    { id: 'diaTodo', rotulo: 'Dia todo', faixa: '' },
    { id: 'manha', rotulo: 'Manhã', faixa: '05h–12h' },
    { id: 'tarde', rotulo: 'Tarde', faixa: '12h–18h' },
    { id: 'noite', rotulo: 'Noite', faixa: '18h–05h' },
];
/**
 * Bloco da linha do tempo para o dia exibido.
 * Uma demanda que começou num dia anterior (ex.: guarda 24h) entra em "Manhã".
 */
export function blocoDe(inicioMs, diaInteiro, diaExibido) {
    if (diaInteiro)
        return 'diaTodo';
    if (inicioMs < diaExibido.getTime())
        return 'manha';
    const h = new Date(inicioMs).getHours();
    if (h >= 5 && h < 12)
        return 'manha';
    if (h >= 12 && h < 18)
        return 'tarde';
    return 'noite';
}
/** Grade do mês começando no domingo (5 ou 6 semanas). */
export function gradeDoMes(ano, mes) {
    const primeiro = new Date(ano, mes, 1);
    const inicio = somaDias(primeiro, -primeiro.getDay());
    const dias = [];
    for (let i = 0; i < 42; i++) {
        const d = somaDias(inicio, i);
        if (i === 35 && d.getMonth() !== mes)
            break;
        dias.push(d);
    }
    return dias;
}
export const semanaDe = (d) => {
    const ini = somaDias(inicioDoDia(d), -d.getDay());
    return Array.from({ length: 7 }, (_, i) => somaDias(ini, i));
};
