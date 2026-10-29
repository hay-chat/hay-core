---
title: Item avariado ou quebrado
trigger: O cliente diz que um item chegou quebrado, lascado, trincado, vazando ou avariado
description: Pede fotos do item e da caixa, confere o prazo de 7 dias, oferece reenvio ou reembolso (o cliente escolhe) só do item avariado e registra o reembolso para a equipe aprovar, sem dizer que o dinheiro voltou. Também vela com defeito e trincas. Cenários RET-03, RET-04, PRD-03.
approvalCategories: [refund]
---

## Reúna as evidências
1. Seja gentil e breve: "Poxa, que pena que chegou assim. Vamos resolver."
2. Encontre o pedido com {{action:nuvemshop_get_order}} (número + e-mail; o e-mail precisa bater).
3. Peça uma foto do item avariado e uma foto da caixa, aqui no chat (pelo clipe). Você consegue ler fotos; diga o que viu para o cliente saber que você olhou.
4. Não peça uma foto que você já recebeu.
5. Confira a data de entrega. A avaria precisa ser avisada em até 7 dias após a entrega. Depois disso, não recuse: transfira para a equipe, que analisa caso a caso.

## Ofereça a solução
Pergunte o que o cliente prefere: um **novo item igual** (reenvio) ou o **reembolso** do item avariado. Não precisa devolver o item quebrado.

### Reembolso
1. Veja a situação com {{action:nuvemshop_check_refund_status}}.
2. Diga ao cliente qual item será reembolsado (uma caneca quebrada de quatro = uma caneca) e confirme.
3. Registre com {{action:nuvemshop_request_refund}} o valor desse item. Isso não devolve dinheiro: anota o pedido para a equipe fazer o estorno no Mercado Pago.
4. Diga que o reembolso foi pedido, que **ainda não foi feito** e que a equipe confirma aqui. Prazos depois do estorno: Pix no mesmo dia; cartão 5 a 10 dias úteis; boleto por transferência em 3 a 5 dias úteis.
5. Transfira para a equipe.

### Reenvio
1. Veja o estoque com {{action:nuvemshop_check_inventory}}.
2. Registre com {{action:nuvemshop_add_order_note}}: "Avaria na entrega: <item>. Fotos no chat. Cliente escolheu reenvio."
3. Transfira para a equipe enviar. Não prometa data de envio.

## Defeito, não avaria
- Vela com pavio que afoga ou não fica aceso é defeito: peça uma foto e siga este playbook, mesmo que já tenha sido acesa.
- Diferença de cor ou esmalte entre duas peças é normal (pequenos lotes), não é defeito. Trinca ou lasca é avaria.

## Nunca
- Nunca peça para o cliente devolver a peça quebrada.
- Nunca diga que o reembolso ou o reenvio foi feito antes de a ferramenta ou a equipe confirmar.
- Se o cliente se machucou (por exemplo, um corte com a cerâmica), peça para cuidar disso primeiro e transfira.
