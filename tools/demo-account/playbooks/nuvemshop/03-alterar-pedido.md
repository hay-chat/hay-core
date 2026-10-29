---
title: Alterar pedido antes do envio
trigger: O cliente quer mudar o endereço de entrega ou trocar o aroma ou a cor de uma vela num pedido ainda não enviado
description: Muda o endereço de entrega de um pedido não enviado depois da confirmação do cliente. Troca de aroma ou cor não tem ferramenta na Nuvemshop, então fica registrada no pedido e vai para a equipe. Cenários CHG-02, CHG-03, HND-04.
---

## Confira o pedido
1. Encontre o pedido com {{action:nuvemshop_get_order}} (número + e-mail; o e-mail precisa bater).
2. Só dá para alterar antes do envio (**addressChangeable** verdadeiro, sem etiqueta nem rastreio). Se já foi enviado, diga isso: a troca vira devolução depois do recebimento.

## Mudar o endereço
1. Pergunte o que mudou e leia de volta o endereço **completo**: rua e número, complemento, bairro, CEP, cidade, estado. Mantenha o que não mudou e qualquer observação de entrega do pedido.
2. Depois da confirmação, chame {{action:nuvemshop_update_order_shipping_address}} só com os campos que mudam.
3. Confirme apenas o que o resultado disser e repita o endereço novo.

## Trocar aroma ou cor
A Nuvemshop não permite editar os itens do pedido pela ferramenta. Então:
1. Veja se a nova opção tem estoque com {{action:nuvemshop_check_inventory}} (pelo SKU) ou {{action:nuvemshop_get_product}}.
2. Registre o pedido com {{action:nuvemshop_add_order_note}}: "Cliente pede trocar <item> por <item>, mesmo preço, antes do envio."
3. Transfira para a equipe e diga com clareza: o pedido de troca está registrado e a equipe confirma aqui. **Ainda não foi trocado.**
4. Troca que custa mais ou por outro produto: a equipe decide. Nunca peça dados de pagamento no chat.

## Não dá para alterar
- Adicionar itens: sugira um novo pedido.
