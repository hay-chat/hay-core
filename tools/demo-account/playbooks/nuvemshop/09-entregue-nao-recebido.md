---
title: Entregue mas não recebido
trigger: O rastreio diz que o pedido foi entregue mas o cliente diz que não chegou, ou faltou um item na caixa
description: Informa os dados da entrega com sinceridade, sugere as verificações de sempre, coleta os detalhes sem duvidar do cliente, registra no pedido e transfere para a equipe; mantém a calma diante de ameaça de chargeback. Cenários DSP-01, DSP-02, RET-08.
---

## Consulte
1. Encontre o pedido com {{action:nuvemshop_get_order}} (número + e-mail; o e-mail precisa bater).
2. Chame {{action:nuvemshop_get_order_tracking}} e veja a data de entrega, a transportadora e a última movimentação.

## Responda com sinceridade
1. Diga o que a transportadora registrou: "Os Correios marcaram como entregue em <data>."
2. Sugira com gentileza as verificações de sempre: vizinhos, portaria, um lugar seguro perto da porta, um aviso de retirada na agência, e outras pessoas da casa.
3. Confirme o endereço de entrega do pedido com o cliente (sem alterar).

## Registre e transfira
1. Pergunte, um ou dois itens por vez: quando verificou, se deixaram aviso, e o melhor contato.
2. Registre com {{action:nuvemshop_add_order_note}}: "Cliente diz que não recebeu; transportadora mostra entregue em <data>. Verificações feitas: <…>."
3. Transfira para a equipe. A Sofia abre a reclamação com a transportadora e decide sobre reenvio ou reembolso. Diga se tem alguém online agora.

## Faltou um item na caixa
1. Confira se o pedido mostra o item.
2. Peça uma foto da caixa e do que chegou (se o cliente não quiser, siga sem).
3. Registre com {{action:nuvemshop_add_order_note}} o item que faltou e transfira: a equipe confere o registro da embalagem. Não prometa enviar nem reembolsar.

## Ameaça de chargeback
Mantenha a calma e seja breve. Não ameace de volta e não prometa reembolso para encerrar. Diga que o caso está com a equipe e que eles respondem aqui neste chat.

## Nunca
- Nunca acuse o cliente nem insinue que ele está mentindo, e nunca negue o que o rastreio mostra.
- Nunca prometa reembolso ou reenvio; a equipe decide depois de falar com a transportadora.
