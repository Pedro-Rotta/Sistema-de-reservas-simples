// URL do Web App do Google Apps Script (termina em /exec). Veja docs/CONFIGURACAO.md.
const RESERVAS_API_URL = '';

(function () {
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const $ = (id) => document.getElementById(id);

  const form = $('reservas-form');
  const slotsEl = $('reservas-slots');
  const telefoneEl = $('reservas-telefone');
  const botao = $('reservas-botao');
  const erroEl = $('reservas-erro');

  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Abra a página com ?demo no final da URL para ver o fluxo com dados de exemplo.
  // Telefone terminado em 1111 simula cliente recorrente.
  const DEMO = new URLSearchParams(location.search).has('demo');

  async function chamarApi(opcoes) {
    if (DEMO) return apiDemo(opcoes);
    if (!RESERVAS_API_URL) throw new Error('sem-url');
    const res = await fetch(RESERVAS_API_URL, opcoes);
    return res.json();
  }

  function apiDemo(opcoes) {
    if (!opcoes) {
      const slots = [];
      for (let i = 1; i <= 21; i++) {
        const d = new Date(Date.now() + i * 864e5);
        if ([2, 3, 4].includes(d.getDay())) {
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          ['09:00', '14:00', '17:00'].forEach((horario) => slots.push({ data: iso, horario }));
        }
      }
      return { ok: true, valorServico: 50, valorSinal: 20, slots };
    }
    const b = JSON.parse(opcoes.body);
    const recorrente = b.telefone.replace(/\D/g, '').endsWith('1111');
    return recorrente
      ? { ok: true, status: 'confirmada', recorrente, data: b.data, horario: b.horario }
      : { ok: true, status: 'aguardando sinal', recorrente, data: b.data, horario: b.horario,
          pix: { valor: 20, copiaECola: 'DEMONSTRACAO-SEM-VALOR-PIX-REAL' } };
  }

  function rotuloData(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
    return `${dia}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }

  function mostrarErro(msg) {
    erroEl.textContent = msg || '';
    erroEl.hidden = !msg;
  }

  function atualizarBotao() {
    const temHorario = !!form.querySelector('input[name="slot"]:checked');
    const digitos = telefoneEl.value.replace(/\D/g, '');
    botao.disabled = !(temHorario && digitos.length >= 10);
  }

  // Máscara simples: (18) 99999-9999
  telefoneEl.addEventListener('input', () => {
    const d = telefoneEl.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 2) v = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) v = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    telefoneEl.value = v;
    atualizarBotao();
  });

  function renderizarSlots(slots) {
    slotsEl.innerHTML = '';
    if (!slots.length) {
      slotsEl.innerHTML = '<p class="reservas-info">Nenhum horário disponível nas próximas semanas.</p>';
      return;
    }
    const porDia = {};
    slots.forEach((s) => (porDia[s.data] = porDia[s.data] || []).push(s.horario));

    Object.keys(porDia).sort().forEach((data) => {
      const bloco = document.createElement('div');
      bloco.className = 'reservas-dia';
      const titulo = document.createElement('h4');
      titulo.textContent = rotuloData(data);
      const horas = document.createElement('div');
      horas.className = 'reservas-horas';

      porDia[data].forEach((horario) => {
        const label = document.createElement('label');
        label.className = 'reservas-hora';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'slot';
        input.value = `${data}|${horario}`;
        input.addEventListener('change', atualizarBotao);
        const span = document.createElement('span');
        span.textContent = horario;
        label.append(input, span);
        horas.appendChild(label);
      });

      bloco.append(titulo, horas);
      slotsEl.appendChild(bloco);
    });
  }

  async function carregarSlots() {
    slotsEl.innerHTML = '<p class="reservas-info">Carregando horários…</p>';
    atualizarBotao();
    try {
      const json = await chamarApi();
      if (!json.ok) throw new Error(json.erro);
      document.querySelectorAll('[data-valor-servico]').forEach((el) => (el.textContent = reais(json.valorServico)));
      renderizarSlots(json.slots);
    } catch (e) {
      slotsEl.innerHTML = e.message === 'sem-url'
        ? '<p class="reservas-info">As reservas pelo site estarão disponíveis em breve. Enquanto isso, chame no <a href="https://wa.me/5518998051878" target="_blank" rel="noopener">WhatsApp</a>.</p>'
        : '<p class="reservas-erro">Não foi possível carregar os horários. Tente novamente mais tarde.</p>';
    }
  }

  function mostrarResultado(r) {
    form.hidden = true;
    $('reservas-resultado').hidden = false;
    const quando = `${rotuloData(r.data)} às ${r.horario}`;

    if (r.recorrente) {
      $('reservas-titulo').textContent = 'Reserva confirmada!';
      $('reservas-detalhe').textContent = `Te espero na ${quando}.`;
      $('reservas-pix').hidden = true;
      return;
    }

    $('reservas-titulo').textContent = 'Horário reservado — falta o sinal';
    $('reservas-detalhe').textContent = `Seu horário: ${quando}.`;
    $('reservas-pix-valor').textContent = reais(r.pix.valor);
    $('reservas-copia-cola').value = r.pix.copiaECola;
    const qr = $('reservas-qrcode');
    qr.innerHTML = '';
    if (window.QRCode) {
      new QRCode(qr, { text: r.pix.copiaECola, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    }
    $('reservas-pix').hidden = false;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mostrarErro('');
    const marcado = form.querySelector('input[name="slot"]:checked');
    if (!marcado) return mostrarErro('Escolha um horário.');
    const [data, horario] = marcado.value.split('|');

    botao.disabled = true;
    botao.textContent = 'Reservando…';
    try {
      // Corpo como texto simples evita o "preflight" de CORS, que o Apps Script não suporta.
      const json = await chamarApi({
        method: 'POST',
        body: JSON.stringify({ data, horario, telefone: telefoneEl.value }),
      });
      if (!json.ok) {
        mostrarErro(json.erro);
        carregarSlots();
        return;
      }
      mostrarResultado(json);
    } catch (e) {
      mostrarErro('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      botao.textContent = 'Reservar';
      atualizarBotao();
    }
  });

  $('reservas-copiar').addEventListener('click', async () => {
    const campo = $('reservas-copia-cola');
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch (e) {
      campo.select();
      document.execCommand('copy');
    }
    $('reservas-copiar').textContent = 'Código copiado!';
    setTimeout(() => ($('reservas-copiar').textContent = 'Copiar código Pix'), 2500);
  });

  $('reservas-nova').addEventListener('click', () => {
    $('reservas-resultado').hidden = true;
    form.hidden = false;
    form.reset();
    carregarSlots();
  });

  carregarSlots();
})();
