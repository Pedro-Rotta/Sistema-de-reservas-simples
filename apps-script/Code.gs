/**
 * Sistema de reservas simples — Google Apps Script (Web App)
 *
 * GET  → lista os horários livres
 * POST → cria uma reserva { data: "yyyy-MM-dd", horario: "HH:mm", telefone: "..." }
 *
 * Este script deve ficar vinculado à planilha (Extensões → Apps Script).
 * Rode a função `setup` uma vez para criar as abas com horários de exemplo.
 */

const CONFIG = {
  ABA_HORARIOS: 'Horarios',
  ABA_RESERVAS: 'Reservas',
  DIAS_A_FRENTE: 21,          // janela de 3 semanas
  VALOR_SERVICO: 50,
  VALOR_SINAL: 20,
  PIX_CHAVE: '+5518998051878',
  PIX_NOME: 'PEDRO AUGUSTO ROTTA',    // até 25 caracteres, sem acento
  PIX_CIDADE: 'PRESIDENTE PRUDENTE',    // até 15 caracteres, sem acento — ajuste para sua cidade
  FUSO: 'America/Sao_Paulo',
  EMAIL_AVISO: 'pedrorotta2006@gmail.com', // recebe um e-mail a cada reserva ('' para desligar)
  TEMPO_MINIMO_MS: 3000,      // envio mais rápido que isso desde que a página abriu = bot
  MAX_PENDENTES: 6,           // reservas "aguardando sinal" ao mesmo tempo, somando todos os números
};

const STATUS = {
  CONFIRMADA: 'confirmada',
  AGUARDANDO: 'aguardando sinal',
  CANCELADA: 'cancelada',
};

const NOMES_DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Horários iniciais da aba "Horarios". Cada linha é uma janela de atendimento (início-fim).
const HORARIOS_EXEMPLO = [
  ['terça', '08:00-11:00', 'sim'], ['terça', '13:00-16:00', 'sim'],
  ['quarta', '08:00-11:00', 'sim'], ['quarta', '13:00-16:00', 'sim'],
  ['quinta', '08:00-11:00', 'sim'], ['quinta', '13:00-16:00', 'sim'],
];

// Colunas da aba "Reservas" (Nome e Endereço ficam no fim para não mexer nas primeiras).
const CABECALHO_RESERVAS = ['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço'];

/* ============================ Configuração ============================ */

/** Rode uma vez pelo editor para criar as abas. Não apaga dados existentes. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este script não está ligado a uma planilha. Abra a planilha e use Extensões → Apps Script.');
  const feito = [];

  let horarios = ss.getSheetByName(CONFIG.ABA_HORARIOS);
  if (!horarios) {
    horarios = ss.insertSheet(CONFIG.ABA_HORARIOS);
    horarios.getRange('A:C').setNumberFormat('@');
    horarios.getRange(1, 1, 1, 3).setValues([['Dia da semana', 'Horário', 'Ativo (sim/não)']]).setFontWeight('bold');
    horarios.getRange(2, 1, HORARIOS_EXEMPLO.length, 3).setValues(HORARIOS_EXEMPLO);
    horarios.setFrozenRows(1);
    feito.push('aba Horarios criada');
  } else {
    feito.push('aba Horarios já existia');
  }

  let reservas = ss.getSheetByName(CONFIG.ABA_RESERVAS);
  if (!reservas) {
    reservas = ss.insertSheet(CONFIG.ABA_RESERVAS);
    reservas.getRange('A:G').setNumberFormat('@');
    reservas.getRange(1, 1, 1, CABECALHO_RESERVAS.length).setValues([CABECALHO_RESERVAS]).setFontWeight('bold');
    reservas.setFrozenRows(1);
    const regra = SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS.CONFIRMADA, STATUS.AGUARDANDO, STATUS.CANCELADA], true)
      .setAllowInvalid(false)
      .build();
    reservas.getRange('D2:D').setDataValidation(regra);
    feito.push('aba Reservas criada');
  } else {
    feito.push('aba Reservas já existia');
  }

  const resumo = 'Planilha "' + ss.getName() + '": ' + feito.join(', ') + '. Abas atuais: ' +
    ss.getSheets().map(function (a) { return a.getName(); }).join(', ');
  console.log(resumo);
  console.log('Endereço da planilha: ' + ss.getUrl());
  ss.toast(feito.join(', '), 'Sistema de reservas', 10);
}

/* ============================ Web App ============================ */

function doGet() {
  try {
    const slots = horariosLivres_();
    return json_({
      ok: true,
      valorServico: CONFIG.VALOR_SERVICO,
      valorSinal: CONFIG.VALOR_SINAL,
      slots: slots,
    });
  } catch (err) {
    console.error('doGet: ' + err);
    return json_({ ok: false, erro: 'Erro ao carregar horários.' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, erro: 'Sistema ocupado, tente novamente em instantes.' });
  }
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(criarReserva_(body));
  } catch (err) {
    console.error('doPost: ' + err);
    return json_({ ok: false, erro: 'Não foi possível concluir a reserva.' });
  } finally {
    lock.releaseLock();
  }
}

function criarReserva_(body) {
  const motivoBot = motivoAntiBot(body, CONFIG.TEMPO_MINIMO_MS);
  if (motivoBot) {
    console.warn('Reserva recusada pelo filtro anti-bot: ' + motivoBot);
    return { ok: false, erro: 'Não foi possível concluir a reserva. Recarregue a página e tente de novo.' };
  }

  const telefone = normalizarTelefone(body.telefone);
  if (!telefone) return { ok: false, erro: 'Telefone inválido. Use DDD + número.' };
  const nome = limparTextoLivre(body.nome, 60);
  if (nome.length < 2) return { ok: false, erro: 'Informe seu nome.' };
  const endereco = limparTextoLivre(body.endereco, 150);
  if (endereco.length < 5) return { ok: false, erro: 'Informe o endereço com rua, número e bairro.' };

  const data = String(body.data || '');
  const horario = normalizarHorario(body.horario);
  const livre = horariosLivres_().some(function (s) { return s.data === data && s.horario === horario; });
  if (!livre) return { ok: false, erro: 'Esse horário não está mais disponível. Escolha outro.' };

  const reservas = lerReservas_();
  const doCliente = reservas.filter(function (r) { return r.telefone === telefone; });
  const recorrente = doCliente.some(function (r) { return r.status === STATUS.CONFIRMADA; });

  // Cliente novo só pode segurar um horário enquanto o sinal não é confirmado.
  if (!recorrente && doCliente.some(function (r) { return r.status === STATUS.AGUARDANDO; })) {
    return {
      ok: false,
      erro: 'Você já tem uma reserva aguardando o sinal. Após a confirmação do Pix, poderá marcar outros horários.',
    };
  }

  // Teto geral: impede que alguém trocando de número ocupe a agenda inteira.
  const pendentes = contarPendentes(reservas);
  if (!recorrente && pendentes >= CONFIG.MAX_PENDENTES) {
    alertarTeto_(pendentes);
    return {
      ok: false,
      erro: 'No momento não conseguimos receber novas reservas pelo site. Chame no WhatsApp (18) 99805-1878 para marcar.',
    };
  }

  const status = recorrente ? STATUS.CONFIRMADA : STATUS.AGUARDANDO;
  const agora = Utilities.formatDate(new Date(), CONFIG.FUSO, 'yyyy-MM-dd HH:mm:ss');
  abaReservas_().appendRow([data, horario, telefone, status, agora, protegerCelula(nome), protegerCelula(endereco)]);

  avisarReserva_({
    data: data, horario: horario, telefone: telefone, nome: nome, endereco: endereco, recorrente: recorrente,
  });

  const resposta = { ok: true, status: status, recorrente: recorrente, data: data, horario: horario };
  if (!recorrente) {
    resposta.pix = {
      valor: CONFIG.VALOR_SINAL,
      copiaECola: gerarPix(CONFIG.PIX_CHAVE, CONFIG.VALOR_SINAL, CONFIG.PIX_NOME, CONFIG.PIX_CIDADE),
    };
  }
  return resposta;
}

/* ============================ Planilha ============================ */

function horariosLivres_() {
  const hoje = Utilities.formatDate(new Date(), CONFIG.FUSO, 'yyyy-MM-dd');
  const ocupados = lerReservas_()
    .filter(function (r) { return r.status !== STATUS.CANCELADA; })
    .map(function (r) { return r.data + ' ' + r.horario; });
  return calcularSlots(hoje, lerHorarios_(), ocupados, CONFIG.DIAS_A_FRENTE);
}

function lerHorarios_() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ABA_HORARIOS);
  const fuso = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return aba.getDataRange().getValues().slice(1)
    .filter(function (l) { return l[0] && l[1] && normalizarTexto(l[2]) !== 'nao'; })
    .map(function (l) {
      return { diaSemana: diaSemanaIndex(l[0]), horario: celulaHorario_(l[1], fuso) };
    })
    .filter(function (h) { return h.diaSemana >= 0 && h.horario; });
}

function lerReservas_() {
  const aba = abaReservas_();
  const fuso = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return aba.getDataRange().getValues().slice(1)
    .filter(function (l) { return l[0] && l[1]; })
    .map(function (l) {
      return {
        data: celulaData_(l[0], fuso),
        horario: celulaHorario_(l[1], fuso),
        telefone: normalizarTelefone(l[2]) || String(l[2]),
        status: normalizarTexto(l[3]),
      };
    });
}

function abaReservas_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ABA_RESERVAS);
}

// O Sheets pode converter "2026-10-20" e "09:00" em datas; aqui voltamos para texto.
function celulaData_(v, fuso) {
  return v instanceof Date ? Utilities.formatDate(v, fuso, 'yyyy-MM-dd') : String(v).trim();
}

function celulaHorario_(v, fuso) {
  if (v instanceof Date) return Utilities.formatDate(v, fuso, 'HH:mm');
  return normalizarHorario(v);
}

/** Envia uma mensagem de teste no WhatsApp para validar a configuração do CallMeBot. */
function testarWhatsApp() {
  notificarWhatsApp_('Teste do sistema de reservas: notificações funcionando!');
}

/** Envia um e-mail de teste para CONFIG.EMAIL_AVISO (na 1ª vez o Google pede autorização). */
function testarEmail() {
  notificarEmail_('Teste do sistema de reservas', 'Avisos por e-mail funcionando!');
}

/* ============================ Avisos ============================ */

function avisarReserva_(r) {
  const texto = montarMensagem(r);
  notificarWhatsApp_(texto);
  notificarEmail_(montarAssunto(r), texto);
}

/** Avisa o dono que o teto foi atingido, no máximo uma vez por hora. */
function alertarTeto_(pendentes) {
  const cache = CacheService.getScriptCache();
  if (cache.get('alerta-teto')) return;
  cache.put('alerta-teto', '1', 3600);
  notificarEmail_('⚠️ Limite de reservas pendentes atingido',
    'Há ' + pendentes + ' reservas aguardando sinal. Novos clientes não conseguem reservar pelo site até alguma ser ' +
    'confirmada, cancelada ou expirar. Se não reconhecer esses pedidos, pode ser um bot: confira a aba Reservas.');
}

function notificarEmail_(assunto, texto) {
  if (!CONFIG.EMAIL_AVISO) return;
  try {
    MailApp.sendEmail({ to: CONFIG.EMAIL_AVISO, subject: assunto, body: texto, name: 'Sistema de reservas' });
  } catch (err) {
    // A reserva já foi gravada; falha no aviso não deve quebrar o fluxo.
    console.warn('Falha ao enviar e-mail: ' + err);
  }
}

function notificarWhatsApp_(texto) {
  const props = PropertiesService.getScriptProperties();
  const phone = props.getProperty('CALLMEBOT_PHONE');
  const apikey = props.getProperty('CALLMEBOT_APIKEY');
  if (!phone || !apikey) {
    console.warn('CallMeBot não configurado (CALLMEBOT_PHONE / CALLMEBOT_APIKEY).');
    return;
  }
  const url = 'https://api.callmebot.com/whatsapp.php'
    + '?phone=' + encodeURIComponent(phone)
    + '&text=' + encodeURIComponent(texto)
    + '&apikey=' + encodeURIComponent(apikey);
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) console.warn('CallMeBot respondeu ' + res.getResponseCode() + ': ' + res.getContentText());
  } catch (err) {
    // A reserva já foi gravada; falha no aviso não deve quebrar o fluxo.
    console.warn('Falha ao enviar WhatsApp: ' + err);
  }
}

/* ============== Funções puras (testadas em tests/test.js) ============== */

/** '' se parece gente; 'armadilha' se o campo invisível veio preenchido; 'rapido' se foi rápido demais. */
function motivoAntiBot(body, tempoMinimoMs) {
  if (String(body.campo_extra == null ? '' : body.campo_extra).trim()) return 'armadilha';
  const tempo = Number(body.tempoMs);
  if (!isFinite(tempo) || tempo < tempoMinimoMs) return 'rapido';
  return '';
}

function contarPendentes(reservas) {
  return reservas.filter(function (r) { return r.status === STATUS.AGUARDANDO; }).length;
}

function calcularSlots(hojeISO, horarios, ocupados, diasAFrente) {
  const p = hojeISO.split('-').map(Number);
  const ocupado = {};
  ocupados.forEach(function (k) { ocupado[k] = true; });
  const slots = [];
  // Começa em 1: reserva permitida só até o dia anterior.
  for (let i = 1; i <= diasAFrente; i++) {
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + i));
    const iso = d.toISOString().slice(0, 10);
    horarios
      .filter(function (h) { return h.diaSemana === d.getUTCDay(); })
      .map(function (h) { return h.horario; })
      .sort()
      .forEach(function (horario) {
        if (!ocupado[iso + ' ' + horario]) slots.push({ data: iso, horario: horario });
      });
  }
  return slots;
}

function normalizarTexto(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function diaSemanaIndex(nome) {
  const n = normalizarTexto(nome).replace(/-feira$/, '');
  return NOMES_DIAS.map(normalizarTexto).indexOf(n);
}

/** "8:00", "08h00", "08:00-11:00", "8:00 às 11:00" → "08:00" ou "08:00-11:00"; '' se inválido. */
function normalizarHorario(v) {
  const hora = function (h, m) { return ('0' + h).slice(-2) + ':' + m; };
  const t = String(v == null ? '' : v).trim().toLowerCase();
  const m = t.match(/^(\d{1,2})[:h](\d{2})(?:\s*(?:-|–|às|as|a)\s*(\d{1,2})[:h](\d{2}))?$/);
  if (!m) return '';
  return m[3] ? hora(m[1], m[2]) + '-' + hora(m[3], m[4]) : hora(m[1], m[2]);
}

/** "08:00-11:00" → "das 08:00 às 11:00"; "09:00" → "às 09:00". */
function descreverHorario(horario) {
  const p = horario.split('-');
  return p.length === 2 ? 'das ' + p[0] + ' às ' + p[1] : 'às ' + horario;
}

/** Texto digitado pelo cliente: uma linha só, sem espaços sobrando, com limite de tamanho. */
function limparTextoLivre(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Impede que um texto começando com = + - @ vire fórmula na planilha. */
function protegerCelula(texto) {
  return /^[=+\-@]/.test(texto) ? "'" + texto : texto;
}

/** Retorna DDD + número (10 ou 11 dígitos) ou '' se inválido. */
function normalizarTelefone(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
  if (d.length === 11 && d[2] !== '9') return '';
  return d.length === 10 || d.length === 11 ? d : '';
}

function formatarTelefone(d) {
  return d.length === 11
    ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7)
    : '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
}

/** Assunto do e-mail, ex.: "🆕 NOVO CLIENTE: Maria Silva, quarta 21/10 08:00-11:00". */
function montarAssunto(r) {
  const p = r.data.split('-').map(Number);
  const dia = NOMES_DIAS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  const quando = dia + ' ' + String(p[2]).padStart(2, '0') + '/' + String(p[1]).padStart(2, '0') + ' ' + r.horario;
  return (r.recorrente ? '✅ Reserva confirmada: ' : '🆕 NOVO CLIENTE: ') + r.nome + ', ' + quando;
}

function montarMensagem(r) {
  const p = r.data.split('-').map(Number);
  const dia = NOMES_DIAS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  const linhas = [
    r.recorrente ? '✅ Nova reserva confirmada' : '🆕 NOVO CLIENTE — aguardando sinal de R$ ' + CONFIG.VALOR_SINAL,
    '📅 ' + dia + ', ' + p[2].toString().padStart(2, '0') + '/' + p[1].toString().padStart(2, '0') + ' ' + descreverHorario(r.horario),
    '👤 ' + r.nome,
    '📍 ' + r.endereco,
    'https://maps.google.com/?q=' + encodeURIComponent(r.endereco),
    '📞 ' + formatarTelefone(r.telefone),
    'https://wa.me/55' + r.telefone,
  ];
  return linhas.join('\n');
}

/* ----- Pix "copia e cola" (BR Code, padrão EMV do Banco Central) ----- */

function gerarPix(chave, valor, nome, cidade) {
  const campo = function (id, valor) { return id + ('0' + valor.length).slice(-2) + valor; };
  const limpar = function (s, max) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '').trim().slice(0, max);
  };
  const payload =
    campo('00', '01') +
    campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave)) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('54', Number(valor).toFixed(2)) +
    campo('58', 'BR') +
    campo('59', limpar(nome, 25)) +
    campo('60', limpar(cidade, 15)) +
    campo('62', campo('05', '***')) +
    '6304';
  return payload + crc16(payload);
}

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), exigido pelo BR Code. */
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
