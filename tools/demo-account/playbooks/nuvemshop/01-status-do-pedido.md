---
title: Onde está meu pedido
trigger: O cliente pergunta onde está o pedido, quando chega, pede o código de rastreio ou diz que não recebeu o e-mail de confirmação
description: Consulta o pedido e o rastreio, informa transportadora, código e prazo, passa o rastreio parado para a equipe com sinceridade e trata um pedido de reembolso como reembolso. Cenários ORD-01, ORD-02, ORD-03, ORD-04, ORD-06, TRS-03, TRS-07.
approvalCategories: [refund]
---

## Encontre o pedido
1. Peça o número do pedido e o e-mail usado na compra, se ainda não tiver.
2. Consulte com {{action:nuvemshop_get_order}}. Se o cliente só tiver o e-mail ou o CPF, use {{action:nuvemshop_find_customer}} e pergunte de qual pedido recente ele está falando.
3. Se o e-mail não bater com o pedido, não passe nenhum dado do pedido (endereço, e-mail, telefone). Peça para conferir o e-mail de confirmação.
4. Se não existir pedido com esse número: números longos costumam ser do Mercado Livre ou da Shopee (veja "Pedido feito no Mercado Livre ou na Shopee"). Se o cliente descrever algo que a Casa Aurora não vende, diga com calma que não encontrou o pedido, que a loja oficial é esta, sugira falar com o banco e ofereça a equipe.

## Informe a situação
Chame {{action:nuvemshop_get_order_tracking}} e responda com o que ele retornar:
- **Ainda não enviado:** diga que o envio acontece em até 2 dias úteis após a confirmação do pagamento, e depois o transporte: PAC 5 a 12 dias úteis, SEDEX 1 a 4 dias úteis (Correios), ou o prazo da Jadlog. Dê a janela em datas.
- **Enviado:** informe a transportadora, o código e o link de rastreio exatamente como vieram, caractere por caractere, e o prazo.
- **Com data marcada (presente, evento):** dê a estimativa da transportadora se houver, senão o prazo da modalidade, e diga com clareza que não pode prometer a data. Ofereça a equipe se a data for importante.
- **Entregue:** informe a data de entrega. Se o cliente diz que não chegou, siga "Entregue mas não recebido".

## Rastreio parado
Se o rastreio do pedido vier com **isStale** verdadeiro, ou o cliente disser que não atualiza há dias:
- Diga com clareza o que o rastreio mostra e a data da última atualização. Não invente onde está o pacote nem prometa data.
- Registre para a equipe com {{action:nuvemshop_add_order_note}}: "Cliente relatou rastreio parado em <data>; última atualização da transportadora em <data>."
- Transfira a conversa para a equipe: a Sofia fala com a transportadora e decide sobre reenvio ou reembolso. Diga se tem alguém online agora; a equipe atende de segunda a sexta, das 09:00 às 18:00 (horário de Brasília).
- "Vocês podem mandar outro?": o reenvio é decisão da equipe. Diga isso; não prometa.
- Se o pacote atrasou e o cliente está chateado, você pode oferecer um cupom de desculpas (veja "Cupom de desculpas").

## "Cadê meu pedido, quero meu dinheiro de volta"
Responda ao pedido de reembolso, não só ao rastreio:
1. Informe os fatos do rastreio com sinceridade (incluindo rastreio parado).
2. Veja a situação com {{action:nuvemshop_check_refund_status}}.
3. Confirme com o cliente e registre o pedido de reembolso com {{action:nuvemshop_request_refund}}. A Nuvemshop não movimenta dinheiro: diga que o pedido foi registrado, que **nenhum valor foi devolvido ainda** e que a equipe faz o estorno.
4. Boleto: o estorno é por transferência bancária para uma conta que o cliente informar, em 3 a 5 dias úteis. Não peça dados bancários completos no chat: a equipe combina isso.
5. Transfira para a equipe. Não dê data para o dinheiro antes da aprovação.

## "Não recebi o e-mail de confirmação"
Não dá para reenviar o e-mail de confirmação pelo chat. Diga isso com clareza, passe os dados do pedido que você vê (itens, total, situação) depois que o e-mail bater, e ofereça a equipe.

## Nunca
- Nunca invente código de rastreio, movimentação ou data de entrega.
- Nunca diga "aguarde 48 horas e tente de novo" nem só "confira o rastreio".
