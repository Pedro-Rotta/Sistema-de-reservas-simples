# Sistema de reservas simples

Sistema de reservas de horários para a landing page, sem backend completo: página estática + Google Sheets + Google Apps Script, com notificação no WhatsApp via CallMeBot.

## Contexto

Tenho uma landing page com minhas informações e quero adicionar reservas de horários.
Quero algo rápido de desenvolver e simples de manter no ar, sem um backend completo.

## Arquitetura

- **Front-end:** página estática (HTML/CSS/JS), hospedagem gratuita (GitHub Pages, Netlify ou Vercel).
- **Dados:** Google Sheets, em vez de CSV.
- **"Backend":** Google Apps Script publicado como Web App:
  - `GET` → devolve os horários livres
  - `POST` → recebe telefone + horário, identifica se o cliente é novo ou recorrente, grava a reserva e envia a notificação
- **Notificação:** WhatsApp para mim via CallMeBot (gratuito, só envia para o próprio número).

CSV no servidor foi descartado: site estático não consegue gravar arquivo, haveria risco de reserva duplicada ou arquivo corrompido, e a lista de telefones poderia ficar exposta.

## Planilha (abas)

- **Horários:** horários fixos por dia da semana (ou marcados como bloqueados)
- **Reservas:** data, horário, telefone, status (`confirmada` / `aguardando sinal` / `cancelada`)
- Clientes recorrentes são identificados pela própria aba Reservas.

## Regras de negócio

- **Dias:** terça a quinta, 2 a 3 horários por dia (**horários exatos ainda a definir**)
- **Janela:** mostra até 3 semanas à frente; reserva permitida até o dia anterior
- **Volume esperado:** 2 a 3 reservas por dia
- **Valor do serviço:** R$ 50
- **Sinal (só na primeira reserva):** R$ 20 via Pix (mostrar o valor em reais, sem porcentagem)
- **Chave Pix:** telefone (18) 99805-1878 → no BR Code: `+5518998051878`
- Gerar "Pix copia e cola" (e QR code) já com o valor de R$ 20

## Fluxo

1. O cliente vê os horários livres, escolhe um e informa o telefone.
2. O script consulta o telefone na aba Reservas:
   - **Recorrente** (tem ao menos 1 reserva `confirmada`): grava como `confirmada`, mostra "Reserva confirmada!" e me notifica no WhatsApp.
   - **Novo:** grava como `aguardando sinal`, o horário fica bloqueado, mostra o aviso do sinal de R$ 20 com Pix copia e cola/QR e me notifica no WhatsApp com a marcação **NOVO CLIENTE**.
3. Não há verificação automática de pagamento. Eu confiro o Pix e mudo o status para `confirmada` manualmente.
4. Se o cliente novo não pagar, eu libero o horário manualmente (apago a linha ou mudo para `cancelada`).

## Limitações aceitas

- O telefone identifica o cliente, mas não comprova quem ele é (alguém poderia usar o número de outra pessoa). Risco baixo para este porte.

## Pendências

- [ ] Definir os horários exatos de cada dia (terça a quinta)
- [x] Criar o repositório do projeto

## Entregáveis

1. [ ] Código do Google Apps Script
2. [ ] Página de reservas (HTML/JS) integrada à landing page
3. [ ] Passo a passo de configuração: planilha, deploy do Apps Script, ativação do CallMeBot e hospedagem
