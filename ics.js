/**
 * Exportação .ics (iCalendar) com alarmes.
 *
 * Por que existe: um PWA não consegue disparar notificação com o app
 * fechado e sem servidor. Ao importar o .ics na agenda do celular (Google
 * Agenda, Calendário do iPhone), os alarmes ficam com o sistema e tocam
 * mesmo offline e com o app fechado.
 */
import { SUBTIPOS } from './catalog.js';

const p2 = (n) => String(n).padStart(2, '0');
const dataUTC = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`;
};
const dataDia = (ms) => { const d = new Date(ms); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`; };
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Quebra linhas longas conforme a RFC 5545 (75 octetos). */
function dobrar(linha) {
  const partes = [];
  let resto = linha;
  while (resto.length > 70) { partes.push(resto.slice(0, 70)); resto = ' ' + resto.slice(70); }
  partes.push(resto);
  return partes.join('\r\n');
}

export function gerarICS(itens) {
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda do Cadete//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const agora = dataUTC(Date.now());
  for (const it of itens) {
    const tipo = SUBTIPOS[it.subtipo]?.rotulo || '';
    linhas.push('BEGIN:VEVENT', `UID:${it.chave || it.id}@agenda-cadete`, `DTSTAMP:${agora}`);
    if (it.diaTodo) {
      linhas.push(`DTSTART;VALUE=DATE:${dataDia(it.inicio)}`, `DTEND;VALUE=DATE:${dataDia(it.inicio + 86400000)}`);
    } else {
      linhas.push(`DTSTART:${dataUTC(it.inicio)}`, `DTEND:${dataUTC(it.fim || it.inicio + 3600000)}`);
    }
    linhas.push(`SUMMARY:${esc(`${tipo ? tipo + ': ' : ''}${it.titulo}`)}`);
    if (it.local) linhas.push(`LOCATION:${esc(it.local)}`);
    if (it.obs) linhas.push(`DESCRIPTION:${esc(it.obs)}`);
    for (const min of it.lembretes || []) {
      // dia todo: alarme relativo às 08:00 do dia (início do evento é 00:00)
      const rel = it.diaTodo ? min - 8 * 60 : min;
      const sinal = rel >= 0 ? '-' : '';
      linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.titulo)}`, `TRIGGER:${sinal}PT${Math.abs(rel)}M`, 'END:VALARM');
    }
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n');
}

/** Baixa o .ics; no celular, abrir o arquivo oferece "Adicionar à agenda". */
export function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
