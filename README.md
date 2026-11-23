# PC Insight

Application Windows qui regroupe en un seul endroit les informations d'un PC : **performances en direct et historisées, matériel, stockage, logiciels, réseau, sécurité, erreurs (journaux d'événements) et mises à jour**, avec graphiques, statistiques et un **diagnostic automatique** noté sur 100. Tout reste en local : aucune donnée n'est envoyée sur Internet.

## Fonctionnalités

Chaque page commence par un **résumé en langage clair** (vert = OK, orange = à surveiller, rouge = problème) ; les termes techniques ont une aide « ? » au survol, et la barre latérale signale les pages qui contiennent des problèmes.

| Page | Contenu |
|---|---|
| Tableau de bord | Score de santé, **à faire en priorité**, CPU/RAM/GPU/disque/réseau en direct (avec températures), protection, mises à jour, démarrage |
| Diagnostic | Constats filtrables (problèmes / conseils / bons points), « Que faire » concret et lien vers la page concernée, export HTML (PDF) + JSON |
| Performances | Temps réel : CPU (**fréquence réelle, turbo compris**), RAM, **charge GPU**, **activité et temps de réponse de chaque disque**, réseau, cœurs, détail mémoire (engagée, cache, pagination). Historique 1 h → 30 jours (CPU, RAM, GPU, températures, profil horaire). Processus regroupés avec leur emplacement |
| Capteurs | Températures CPU/GPU/disques, puissance, ventilateurs, tensions, fréquences ; détail des moteurs GPU (3D, vidéo…) ; assistant d'installation de LibreHardwareMonitor |
| Matériel | CPU, GPU (VRAM réelle), RAM (XMP/EXPO, double canal), carte mère/BIOS, écrans, batterie, périphériques en erreur, **pilotes tiers (version, date, signature)**, firmware, activation, mode d'alimentation, **durée des démarrages**, points de restauration |
| Stockage | Volumes, santé/usure/température des disques, activité en direct, évolution de l'espace, fichiers temporaires |
| Logiciels | Programmes installés, Store, démarrage, **tâches planifiées tierces**, services (filtre **services tiers** + exécutable) |
| Sécurité | 13 points de contrôle expliqués (Defender, pare-feu, UAC, Secure Boot, BitLocker, SMBv1, RDP/NLA, HVCI, **protection LSA**, TPM…), **éléments de persistance suspects**, fichier hosts, proxy, exclusions Defender, comptes |
| Réseau | Wi-Fi détaillé (bande, canal, norme, débits, chiffrement), IP, passerelle, DNS, profil, ports en écoute avec processus, connexions |
| Événements | Erreurs par jour/heure, sources, écrans bleus, arrêts brutaux, plantages d'applications, indice de fiabilité, **durée et nombre de démarrages** |
| Mises à jour | Historique catégorisé, échecs expliqués, fin de support de Windows, recherche des mises à jour disponibles |
| Paramètres | Port de LibreHardwareMonitor et test de connexion, dossier des données, thème |

## Capteurs : d'où viennent les mesures ?

| Source | Ce qu'elle fournit | Installation |
|---|---|---|
| Compteurs de performance Windows (API PDH, via ctypes) | Charge GPU tous fabricants, VRAM utilisée, fréquence CPU réelle, activité/latence des disques, mémoire engagée, zones thermiques ACPI | Aucune |
| `nvidia-smi` | Température, puissance, ventilateur, fréquences du GPU NVIDIA | Fourni avec le pilote NVIDIA |
| [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (optionnel) | Tout le reste : températures CPU par cœur, carte mère, SSD, ventilateurs, tensions, puissance CPU | `winget install --id LibreHardwareMonitor.LibreHardwareMonitor -e` + pilote [PawnIO](https://github.com/namazso/PawnIO.Setup/releases) |

PC Insight **n'installe aucun pilote noyau** : il lit les mesures de LibreHardwareMonitor via son serveur web local (`http://127.0.0.1:8085/data.json`, à activer dans *Options → Remote Web Server → Run*). À savoir avant d'installer LibreHardwareMonitor :
- son pilote PawnIO tourne dans le noyau (il remplace l'ancien WinRing0, vulnérable : CVE-2020-14979) ; certains anti-triche de jeux en ligne le refusent ;
- son serveur web n'a pas de mot de passe par défaut et écoute sur toutes les interfaces : refusez l'accès réseau public dans le pare-feu ou activez son authentification.

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
├── settings.py       réglages (port de LibreHardwareMonitor)
├── history.py        historique SQLite (agrégation par minute)
├── report.py         export HTML/JSON
├── collectors/       une source de données par fichier (psutil, registre, PowerShell,
│                     compteurs PDH via ctypes, capteurs LibreHardwareMonitor / nvidia-smi)
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
- **Températures du processeur et ventilateurs** : nécessitent LibreHardwareMonitor (voir plus haut). Sans lui, seule une zone thermique ACPI approximative est affichée quand Windows l'expose.
- **Correspondance des cartes graphiques** : avec plusieurs GPU, le détail des moteurs est numéroté (« Carte graphique 1, 2 ») ; la carte qui utilise le plus de mémoire dédiée est considérée comme principale.
- Certaines informations exigent les droits administrateur : usure/température des SSD (sans LibreHardwareMonitor), TPM, durées de démarrage, points de restauration, exclusions Defender.
- Les dates de fin de support Windows sont codées en dur (source : Microsoft Learn, novembre 2026).
- Le score de santé et la détection de « persistance suspecte » reposent sur des heuristiques : un signalement est une piste à vérifier, pas une preuve d'infection.
