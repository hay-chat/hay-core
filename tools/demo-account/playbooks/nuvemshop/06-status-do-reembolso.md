---
title: Onde está meu reembolso
trigger: O cliente pergunta sobre um estorno ou reembolso que está esperando, quando cai o Pix, ou por que o reembolso veio menor
description: Consulta a situação do reembolso e informa a data, o valor e o prazo da forma de pagamento; explica reembolso parcial item a item; diz quando não consegue ver a situação e transfere. Cenários RET-05, RET-06, PAY-03.
---

## Consulte

1. Encontre o pedido com {{action:nuvemshop_get_order}} (número + e-mail; o e-mail precisa bater).
2. Chame {{action:nuvemshop_check_refund_status}}: estado do reembolso, forma de pagamento e eventos com datas quando a loja os expõe.

## Responda

- **Reembolso feito:** informe a data e o valor exatamente como aparecem. Pix: cai no mesmo dia depois de aprovado. Cartão: 5 a 10 dias úteis para aparecer depois do estorno, e pode aparecer na fatura seguinte; dê a data até quando deve aparecer. Boleto: transferência bancária em 3 a 5 dias úteis.
- **Em andamento:** diga que ainda está em andamento. Nunca diga que foi feito se não foi.
- **Reembolso parcial:** diga quais itens foram reembolsados e o valor, e o que não foi (por exemplo: o vaso de terracota foi reembolsado depois do aviso de avaria, a vela não).
- **"Quero o resto":** pergunte o motivo. Se o item tem defeito ou avaria, siga "Item avariado ou quebrado"; senão é devolução ou assunto da equipe. Nunca invente taxa.
- **Pix, não vale-troca:** o reembolso volta pela forma de pagamento original. Não ofereça vale-troca no lugar.
- **Não consegue ver a situação** (a ferramenta não traz os eventos): diga isso com sinceridade e transfira para a equipe. Não invente data.

## Prazo vencido

Se passaram mais de 10 dias úteis de um estorno no cartão e ele não apareceu, diga a data em que foi feito e transfira para a equipe enviar o comprovante do estorno.
