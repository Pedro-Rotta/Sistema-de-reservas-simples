// Testes do Code.gs rodando no Node com uma planilha simulada.
// Uso: node tests/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---------- Simulação mínima dos serviços do Apps Script ---------- */
function criarAmbiente(hojeISO, abas) {
  const enviados = [];
  const fmt = (d, tz, pattern) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
    return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const sheet = (linhas) => ({
    getDataRange: () => ({ getValues: () => linhas.map((l) => l.slice()) }),
    appendRow: (l) => linhas.push(l),
  });
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(`${hojeISO}T12:00:00-03:00`); }
  }
  const ctx = {
    console: { warn: () => {}, log: console.log },
    Date: FakeDate,
    Utilities: { formatDate: fmt },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheet(abas[n]),
        getSpreadsheetTimeZone: () => 'America/Sao_Paulo',
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => ({ CALLMEBOT_PHONE: '+5518998051878', CALLMEBOT_APIKEY: '123' })[k] }),
    },
    UrlFetchApp: {
      fetch: (url) => { enviados.push(decodeURIComponent(url.match(/text=([^&]*)/)[1])); return { getResponseCode: () => 200 }; },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  ctx.enviados = enviados;
  return ctx;
}

const post = (g, body) => g.doPost({ postData: { contents: JSON.stringify(body) } });
let total = 0;
const teste = (nome, fn) => { fn(); total++; console.log('ok -', nome); };

/* ------------------------------ Testes ------------------------------ */

teste('crc16 bate com o valor de referência CCITT-FALSE', () => {
  const g = criarAmbiente('2026-10-19', {});
  assert.strictEqual(g.crc16('123456789'), '29B1');
});

teste('Pix copia e cola tem estrutura e CRC válidos', () => {
  const g = criarAmbiente('2026-10-19', {});
  const pix = g.gerarPix('+5518998051878', 20, 'Pedro Rotta', 'São Paulo');
  assert.ok(pix.startsWith('000201'));
  assert.ok(pix.includes('0014br.gov.bcb.pix0114+5518998051878'));
  assert.ok(pix.includes('540520.00'));
  assert.ok(pix.includes('5911PEDRO ROTTA6009SAO PAULO'));
  assert.strictEqual(g.crc16(pix.slice(0, -4)), pix.slice(-4));
  // Percorre os campos TLV e confere que os tamanhos fecham exatamente.
  let i = 0;
  while (i < pix.length) { const n = Number(pix.substr(i + 2, 2)); i += 4 + n; }
  assert.strictEqual(i, pix.length);
});

teste('slots: só ter/qua/qui, começam amanhã e vão até 21 dias', () => {
  const g = criarAmbiente('2026-10-20', {}); // terça
  const horarios = [{ diaSemana: 2, horario: '09:00' }, { diaSemana: 3, horario: '14:00' }, { diaSemana: 4, horario: '17:00' }];
  const slots = g.calcularSlots('2026-10-20', horarios, ['2026-10-22 17:00'], 21);
  assert.ok(!slots.some((s) => s.data === '2026-10-20'), 'não pode reservar no mesmo dia');
  assert.strictEqual(slots[0].data, '2026-10-21');
  assert.ok(!slots.some((s) => s.data === '2026-10-22'), 'horário ocupado some');
  assert.strictEqual(slots[slots.length - 1].data, '2026-11-10'); // terça, dia 21
  assert.strictEqual(slots.length, 8);
});

teste('telefone: normaliza formatos e rejeita inválidos', () => {
  const g = criarAmbiente('2026-10-19', {});
  assert.strictEqual(g.normalizarTelefone('(18) 99805-1878'), '18998051878');
  assert.strictEqual(g.normalizarTelefone('+55 18 99805-1878'), '18998051878');
  assert.strictEqual(g.normalizarTelefone('1832221234'), '1832221234');
  assert.strictEqual(g.normalizarTelefone('12345'), '');
  assert.strictEqual(g.normalizarTelefone('18123456789'), '');
});

teste('fluxo: cliente novo fica aguardando sinal, recebe Pix e bloqueia o horário', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '09:00', 'sim'], ['Quarta-feira', '14:00', 'sim'], ['quinta', '17:00', 'não']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em']],
  };
  const g = criarAmbiente('2026-10-19', abas); // segunda
  const antes = g.doGet();
  assert.ok(antes.ok);
  assert.ok(!antes.slots.some((s) => s.horario === '17:00'), 'horário inativo não aparece');
  assert.deepStrictEqual({ ...antes.slots[0] }, { data: '2026-10-20', horario: '09:00' });

  const r = post(g, { data: '2026-10-20', horario: '09:00', telefone: '(18) 99999-0000' });
  assert.strictEqual(r.status, 'aguardando sinal');
  assert.strictEqual(r.recorrente, false);
  assert.strictEqual(r.pix.valor, 20);
  assert.ok(g.enviados[0].includes('NOVO CLIENTE'));
  assert.deepStrictEqual(Array.from(abas.Reservas[1]).slice(0, 4), ['2026-10-20', '09:00', '18999990000', 'aguardando sinal']);

  const depois = g.doGet();
  assert.ok(!depois.slots.some((s) => s.data === '2026-10-20' && s.horario === '09:00'));

  const dup = post(g, { data: '2026-10-20', horario: '09:00', telefone: '18988887777' });
  assert.strictEqual(dup.ok, false, 'não permite reserva duplicada');

  const segunda = post(g, { data: '2026-10-21', horario: '14:00', telefone: '18999990000' });
  assert.strictEqual(segunda.ok, false, 'cliente novo não segura dois horários sem pagar');
});

teste('fluxo: cliente recorrente é confirmado direto, sem Pix', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '09:00', 'sim'], ['quarta', '14:00', 'sim']],
    // Datas/horas vindas como Date (como o Sheets faz quando a coluna não é texto)
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em'],
      [new Date('2026-10-01T03:00:00Z'), new Date('1899-12-30T12:06:28Z'), 18999990000, 'Confirmada', '']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  const r = post(g, { data: '2026-10-21', horario: '14:00', telefone: '+55 (18) 99999-0000' });
  assert.strictEqual(r.status, 'confirmada');
  assert.strictEqual(r.pix, undefined);
  assert.ok(g.enviados[0].includes('confirmada'));
  assert.ok(!g.enviados[0].includes('NOVO CLIENTE'));
});

teste('cancelada libera o horário', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '09:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em'], ['2026-10-20', '09:00', '18999990000', 'cancelada', '']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  assert.ok(g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '09:00'));
});

console.log(`\n${total} testes passaram.`);
