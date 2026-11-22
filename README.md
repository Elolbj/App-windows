# PC Insight

Application Windows qui regroupe en un seul endroit les informations d'un PC : **performances en direct et historisées, matériel, stockage, logiciels, réseau, sécurité, erreurs (journaux d'événements) et mises à jour**, avec graphiques, statistiques et un **diagnostic automatique** noté sur 100. Tout reste en local : aucune donnée n'est envoyée sur Internet.

## Fonctionnalités

| Page | Contenu |
|---|---|
| Tableau de bord | Score de santé, tuiles CPU/RAM/disque/uptime/erreurs/mises à jour, activité en direct, points à surveiller |
| Performances | Graphiques temps réel (CPU, RAM, disques, réseau, charge par cœur), **historique 1 h → 30 jours** (moyenne, pic, 95e centile, profil horaire), processus regroupés par application |
| Matériel | CPU, GPU (VRAM réelle), barrettes de RAM (vitesse configurée vs nominale), carte mère/BIOS, écrans, batterie (usure), périphériques en erreur |
| Stockage | Volumes et espace libre, disques physiques (SSD/HDD, NVMe/SATA, santé, température et usure en admin), évolution de l'espace utilisé, fichiers temporaires |
| Logiciels | Programmes installés (registre 32/64 bits + utilisateur), applications du Store, programmes au démarrage (activés/désactivés), services ; graphiques éditeurs/taille/installations par mois |
| Réseau | Interfaces, IP, passerelle, DNS, profil réseau (public/privé), Wi-Fi, débit en direct, **ports en écoute avec processus et exposition**, connexions TCP |
| Sécurité | Defender/antivirus tiers, signatures, pare-feu, UAC, Secure Boot, BitLocker, SMBv1, RDP/NLA, HVCI, TPM, comptes locaux et administrateurs |
| Événements | Critiques/erreurs/avertissements des journaux Système et Application (30 jours), par jour ou par heure, sources principales, écrans bleus et arrêts inattendus, plantages d'applications, **indice de stabilité Windows** |
| Mises à jour | Historique Windows Update catégorisé, taux de réussite, échecs non résolus avec explication du code d'erreur, fin de support de votre version de Windows, recherche des mises à jour disponibles (sans rien installer) |
| Diagnostic | Constats classés par gravité avec conseils, score par catégorie, **export d'un rapport HTML (imprimable en PDF) + JSON** dans `Documents\PC Insight` |

## Lancer l'application

### Option 1 — exécutable prêt à l'emploi (sans Python)
Chaque push déclenche le workflow GitHub Actions **Windows** qui teste l'application sur un vrai Windows et construit l'exécutable. Dans l'onglet *Actions* du dépôt → dernier run → artefact **PCInsight-windows** : décompressez et lancez `PCInsight.exe`.

Ou construisez-le vous-même : double-clic sur `build.bat` → `dist\PCInsight\PCInsight.exe`.

### Option 2 — depuis les sources
Prérequis : Windows 10/11, [Python 3.10+](https://www.python.org/downloads/) et le runtime WebView2 (déjà présent sur Windows 11 et sur Windows 10 à jour).

```bat
lancer.bat
```
ou manuellement :
```bat
py -m pip install -r requirements.txt
py -m pcinsight
```

Options utiles :

| Option | Effet |
|---|---|
| `--browser` | ouvre l'interface dans le navigateur au lieu d'une fenêtre |
| `--demo` | données d'exemple (activé automatiquement hors Windows, pratique pour développer l'interface) |
| `--collect` | collecte l'historique de performances en arrière-plan, sans interface |
| `--selftest` | exécute chaque collecteur et affiche un bilan JSON |
| `--debug` | journal détaillé et outils de développement de la fenêtre |

**Droits administrateur** : l'application fonctionne sans, mais certaines données en ont besoin (température/usure des SSD, TPM, état BitLocker détaillé). Bouton « Relancer en admin » dans la barre latérale.

**Historique continu** : les performances ne sont enregistrées que lorsque l'application tourne. Pour un historique complet, placez un raccourci vers `PCInsight.exe --collect` dans le dossier de démarrage (`Win + R` → `shell:startup`). Les données (une moyenne par minute, 30 jours max) sont dans `%LOCALAPPDATA%\PCInsight\history.db`.

## Architecture

```
pcinsight/
├── app.py            point d'entrée : serveur local + fenêtre pywebview (WebView2)
├── server.py         serveur HTTP local (API JSON + fichiers de l'interface)
├── api.py            routes de l'API
├── store.py          cache des sections (TTL, une seule collecte à la fois)
├── analysis.py       règles du diagnostic et calcul du score
├── history.py        historique SQLite (agrégation par minute)
├── report.py         export HTML/JSON
├── collectors/       une source de données par fichier (psutil, registre, PowerShell)
├── scripts/*.ps1     requêtes WMI/CIM, journaux, Windows Update (résultat JSON)
└── web/              interface HTML/CSS/JS + Chart.js 4.5.1 (local, licence MIT)
```

- **Collecte** : `psutil` pour les mesures en direct, le module `winreg` pour le registre (logiciels, démarrage, réglages de sécurité), et des scripts PowerShell 5.1 (présents sur tout Windows 10/11) pour WMI/CIM, les journaux d'événements (`Get-WinEvent`) et l'API COM de Windows Update. Les scripts écrivent leur JSON dans un fichier temporaire UTF-8 pour éviter les problèmes d'encodage de la console.
- **Interface** : HTML/CSS/JS sans framework ni dépendance réseau, affichée dans une fenêtre native WebView2.

### Sécurité du serveur local
L'interface parle au moteur Python via HTTP, ce qui pourrait exposer les données à d'autres programmes ou sites web. Protections en place :
- écoute sur `127.0.0.1` uniquement, port aléatoire ;
- jeton aléatoire de 256 bits exigé sur chaque appel `/api` (en-tête `X-Token`, jamais dans un cookie) : un site web ne peut ni le lire ni le deviner ;
- vérification de l'en-tête `Host` (bloque le *DNS rebinding*) et aucun en-tête CORS ;
- `Content-Security-Policy` stricte (aucun script inline, aucune ressource externe) et échappement systématique des données affichées : un nom de programme ou un message d'événement contenant du HTML ne peut pas s'exécuter ;
- les actions (ouvrir le rapport, relancer en admin) n'acceptent aucun chemin ni commande venant de l'interface.

## Tests

```bat
py -m pip install -r requirements-dev.txt
py -m pytest -q
py -m pcinsight --selftest
```

Les tests unitaires (analyse, statistiques, décodages, sécurité du serveur) tournent sur n'importe quel OS ; `--selftest` vérifie les collecteurs réels et n'a de sens que sous Windows. Le workflow `.github/workflows/windows.yml` exécute les deux sur un runner Windows, puis construit et teste l'exécutable.

## Limites connues
- **Températures CPU/GPU et charge GPU** : non disponibles via les API Windows standard sans pilote tiers (LibreHardwareMonitor, HWiNFO). Seule la température des disques est lue (en admin).
- La fréquence CPU affichée par Windows est souvent la fréquence de base, pas la fréquence turbo instantanée.
- Les dates de fin de support Windows sont codées en dur (source : Microsoft Learn, novembre 2026) et devront être complétées pour les versions futures.
- Le score de santé repose sur des seuils indicatifs ; un point « à surveiller » n'est pas forcément un problème selon l'usage.
