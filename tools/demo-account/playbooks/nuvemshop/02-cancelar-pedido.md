---
title: Cancelar pedido antes do envio
trigger: O cliente quer cancelar um pedido
description: Confere se o pedido ainda não foi enviado, confirma com o cliente, cancela (aguardando aprovação) e registra o pedido de reembolso, sem dizer que o dinheiro voltou. Pedido enviado vira devolução. Cenários CHG-01, CHG-04.
approvalCategories: [cancel, refund]
---

## Confira o pedido
1. Encontre o pedido com {{action:nuvemshop_get_order}} (número + e-mail; o e-mail precisa bater).
2. Leia o **supportSummary**. Dá para cancelar até o envio (pedido aberto, sem rastreio nem etiqueta).
   - **Já enviado:** diga que não dá mais para cancelar. Ofereça a devolução depois de receber: direito de arrependimento de 7 dias a partir do recebimento, ou devolução em até 30 dias, sem uso e na embalagem original.
   - **Já cancelado:** diga isso e veja o reembolso com {{action:nuvemshop_check_refund_status}}.

## Cancele
1. Peça a confirmação: "Posso cancelar o pedido #… e pedir o reembolso do valor total na forma de pagamento original?"
2. Só depois de um sim claro, chame {{action:nuvemshop_cancel_order}}.
3. Cancelar **não reembolsa**. Se o pedido estava pago, registre o reembolso com {{action:nuvemshop_request_refund}}: isso anota o pedido para a equipe, não devolve o dinheiro.
4. Leia os resultados:
   - **Aguardando aprovação:** diga "Pedi a aprovação da equipe. Isso ainda não foi feito, e você vai receber a resposta deles aqui neste chat." Pedidos grandes sempre esperam a aprovação da Marina.
   - **Cancelado:** confirme o cancelamento e diga que o reembolso foi pedido e ainda não foi feito. Prazos depois do estorno: Pix no mesmo dia; cartão 5 a 10 dias úteis; boleto por transferência em 3 a 5 dias úteis.
   - **Recusado pela equipe:** explique o motivo que a equipe deu e ofereça o que ela sugeriu. A conversa continua aberta.
   - **Expirou:** se ninguém decidiu a tempo, diga que não foi feito e que a equipe vai responder aqui.
   - **Recusado pela loja:** explique (por exemplo, já tem etiqueta) e ofereça a devolução.

## Nunca
- Nunca diga que o pedido foi cancelado ou que o dinheiro voltou antes de a ferramenta confirmar.
- Não cancele para mudar endereço ou aroma: use "Alterar pedido antes do envio".
