"""Collecteurs de données. Chaque module expose une fonction `collect()` qui renvoie un dict
sérialisable en JSON. Les sections Windows lèvent une exception hors Windows : l'application
bascule alors sur les données de démonstration (voir demo.py)."""
