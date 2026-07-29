---
'@klad/docs': patch
---

"Go to node" no longer builds an option per node.

It was a `<select>`, which meant one `<option>` element for every node in the
example — fine on the twenty-eight-node chart it was written for, and nearly
nine thousand elements on the wide-levels one. On a phone that is also a native
picker nobody can scroll to the end of.

It opens the same searchable list the aggregate node's picker uses, which
builds only the rows in view. Same dataset, seventeen elements instead of eight
thousand seven hundred and eighty-one, and you can type a name instead of
scrolling for it.
