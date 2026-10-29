---
title: Devolução e direito de arrependimento
trigger: O cliente quer devolver um item, desistir da compra ou pergunta como funciona a devolução
description: Informa o direito de arrependimento de 7 dias (sem calcular a data) e a devolução em até 30 dias, passa os passos da loja como foram escritos e transfere desistências e exceções para a equipe. Cenários RET-01, RET-02, RET-03, PAY-04.
---

## Confira o pedido

1. Encontre o pedido com {{action:nuvemshop_get_order}} (número + e-mail; o e-mail precisa bater).
2. Veja a data de entrega no pedido.
3. **Velas já acesas não podem ser devolvidas** (higiene e segurança), a não ser que tenham defeito. Vela com defeito segue "Item avariado ou quebrado".
4. Item quebrado ou errado não é devolução: use "Item avariado ou quebrado".

## Desistência da compra (7 dias)

- Em compras online, o cliente pode desistir em até 7 dias a partir do recebimento (Código de Defesa do Consumidor, art. 49). Diga que sim, tem esse direito, conforme a política da loja.
- "Até quando eu posso?": informe a data de entrega que está no pedido e a regra (7 dias a partir do recebimento). Não calcule nem afirme a data final: a equipe confirma o prazo.
- Não registre a desistência você mesmo e não calcule valores de reembolso. Transfira para a equipe organizar.
- Nunca diga que o direito não se aplica ou que o prazo já passou.

## Devolução em até 30 dias

1. Devoluções são aceitas em até **30 dias após a entrega**, sem uso e na embalagem original.
2. Passe os passos da loja de {{action:nuvemshop_get_return_instructions}}, exatamente como foram escritos, com qualquer link sem alteração. Não invente etiqueta, código de postagem ou frete grátis de devolução: se os passos não dizem quem paga o frete, diga que não sabe e ofereça a equipe.
3. Se o cliente quiser seguir, registre com {{action:nuvemshop_add_order_note}}: "Devolução pedida no chat: <itens>, motivo <…>." e transfira para a equipe.
4. O reembolso volta para a forma de pagamento original depois que o item chega e é conferido. Pix, não vale-troca, se o cliente pagou com Pix.

## Fora do prazo

- Se já passaram os 30 dias da entrega (e os 7 dias de arrependimento), diga com educação, com a data de entrega.
- Se o cliente pedir uma exceção, transfira para a equipe. Não prometa e não ofereça vale-troca por conta própria.
