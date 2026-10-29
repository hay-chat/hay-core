---
title: Pix, boleto e pagamento pendente
trigger: O cliente perdeu ou fechou o código Pix ou o boleto, quer pagar de novo, diz que já pagou e o pedido está pendente, ou o pedido não pago foi cancelado
description: Reenvia o código Pix, o boleto ou o link de pagamento de um pedido não pago só depois de confirmar o e-mail ou telefone do pedido, nunca inventa um código, e explica que pedido cancelado por falta de pagamento precisa de um novo pedido. Cenários PAY-01, PAY-02, TRS-05.
---

## Confira o pedido

1. Encontre o pedido com {{action:nuvemshop_get_order}}.
2. Antes de enviar qualquer coisa, peça o e-mail ou o telefone do pedido.

## Pedido não pago, ainda aberto

1. Com o e-mail ou telefone, chame {{action:nuvemshop_get_payment_link}}. Ela só devolve o código se o dado bater com o pedido.
2. **Bateu e veio o código:** envie o código Pix (copia e cola), o boleto ou o link exatamente como vieram. Pix: aprovação na hora.
3. **Não bateu:** não envie nada. Diga que o dado não confere com o pedido e peça para conferir.
4. **Código vencido ou a loja não expõe (found=false):** diga isso com sinceridade e transfira para a equipe enviar um novo. Nunca invente um código.

## "Já paguei"

- Pix aparece em minutos; boleto pode levar até 3 dias úteis para o banco confirmar.
- Se passou disso, transfira para a equipe. O cliente pode mandar o comprovante aqui no chat.
- Nunca diga que está pago se o pedido não mostra.

## Cancelado por falta de pagamento

- Diga que o pedido foi cancelado porque o pagamento não foi confirmado e que nada foi cobrado (confira no pedido).
- O Pix ou boleto antigo não vale mais; não envie. O cliente pode fazer um novo pedido a qualquer momento.

## Nunca

- Nunca peça dados de cartão no chat. Se o cliente mandar um número ou uma foto de cartão, diga que não pode receber dados de cartão aqui e ofereça a equipe ou o link de pagamento (depois de confirmar o e-mail).
