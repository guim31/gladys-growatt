# Growatt

Suivez vos **onduleurs solaires et batteries Growatt** dans Gladys : production solaire, énergie
du jour et index de production, niveau et puissance de la batterie, import et export réseau,
consommation de la maison, état de l'onduleur. Les données viennent du cloud Growatt (ShineServer,
l'application ShinePhone), lues toutes les 5 minutes : le rythme auquel les enregistreurs Growatt
remontent. L'intégration ne fait que lire : elle ne modifie jamais un réglage de l'onduleur.

> Développée sans le matériel : vos retours sont les bienvenus. Cette intégration n'est pas
> affiliée à Growatt.

## Prérequis

- Une installation Growatt visible dans l'application ShinePhone ou sur server.growatt.com, son
  enregistreur (ShineWiFi, ShineLAN, ShineLink) en ligne.
- L'un des deux accès :
  - un **jeton OpenAPI** (recommandé). Certains comptes peuvent le créer dans les réglages du
    compte sur server.growatt.com ; sinon, demandez-le au support Growatt ou à votre installateur ;
  - l'**identifiant et le mot de passe de l'application ShinePhone**.
- Gladys 5.1 ou plus récent, avec un accès à Internet.

## Configuration

Ouvrez l'onglet **Configuration** de l'intégration.

### Jeton OpenAPI (recommandé)

Choisissez **Jeton OpenAPI** comme mode de connexion et collez le jeton. L'OpenAPI est l'interface
que Growatt documente pour les logiciels tiers : pas de connexion, rien de stocké par
l'intégration. Les données détaillées existent pour la famille **MIN** (MIN, TL-X, TL-XH, MOD,
MIC) et les hybrides **SPH** ; les autres appareils sont comptés dans les totaux de
l'installation.

### Compte ShinePhone

Choisissez **Compte ShinePhone** et saisissez l'identifiant et le mot de passe de l'application.
Cet accès **peut être bloqué par Growatt** : l'interface n'est pas documentée, son serveur refuse
d'emblée certaines connexions (HTTP 403, une protection anti-robots que l'intégration ne cherche
pas à contourner) et **bloque un compte qui se connecte trop souvent** (erreur 507, pendant
environ une journée). Préférez un jeton quand c'est possible. L'intégration se connecte donc
une fois, garde la session dans son volume `/data` (jamais le mot de passe) et la réutilise, même
après un redémarrage ; elle ne se reconnecte que quand la session expire, et jamais deux fois en
10 minutes. Les données détaillées existent pour les onduleurs string, les TL-X / MIN et les SPH
(MIX).

### Autres réglages

- **Serveur Growatt** : la région où le compte a été créé (Europe et autres régions, Amérique du
  Nord, Australie et Nouvelle-Zélande, Chine).
- **Installations à suivre** : vide pour toutes les installations du compte, ou les identifiants
  d'installation séparés par des virgules.
- **Intervalle de rafraîchissement** : 5 minutes par défaut, ou 10, 15, 30. Growatt refuse une
  lecture plus rapide que 5 minutes.
- **Langue des noms de fonctionnalités** : les noms donnés aux fonctionnalités à l'ajout d'un
  appareil, et la langue de l'état de l'onduleur (français par défaut).

Enregistrez, puis cliquez sur **Tester la connexion** : le message liste les installations et
les onduleurs trouvés. Les appareils apparaissent dans l'onglet **Découverte** : ajoutez ceux que
vous voulez.

## Appareils

### Installation

Un appareil par installation Growatt, avec les totaux que Growatt calcule pour toute
l'installation :

| Fonctionnalité          | Unité | Signification                              |
| ----------------------- | ----- | ------------------------------------------ |
| Puissance de production | W     | Puissance produite en ce moment            |
| Production aujourd'hui  | kWh   | Énergie produite depuis minuit             |
| Index de production     | kWh   | Énergie produite depuis la mise en service |

### Onduleur

Un appareil par onduleur que l'API lit en détail. Les fonctionnalités suivent ce que l'onduleur
remonte : une batterie n'apparaît que sur une installation qui en a une, les fonctionnalités
réseau et maison seulement quand un compteur Growatt (ou une pince) est raccordé.

| Fonctionnalité                                          | Unité  | Signification                                      |
| ------------------------------------------------------- | ------ | -------------------------------------------------- |
| État de l'onduleur                                      | texte  | Normal, En attente, En défaut, Hors ligne          |
| Puissance solaire                                       | W      | Puissance des panneaux                             |
| Tension PV1, Intensité PV1, PV2…                        | V, A   | Chaque chaîne de panneaux                          |
| Puissance de sortie de l'onduleur                       | W      | Puissance alternative fournie par l'onduleur       |
| Production aujourd'hui, Index de production             | kWh    | Énergie solaire du jour, depuis la mise en service |
| Niveau de batterie                                      | %      | État de charge                                     |
| Puissance de charge batterie, de décharge batterie      | W      | Puissance qui entre dans la batterie, qui en sort  |
| Index de charge batterie, de décharge batterie          | kWh    | Énergie chargée et déchargée depuis le début       |
| Puissance importée du réseau, exportée vers le réseau   | W      | Puissance prise au réseau, envoyée au réseau       |
| Index import réseau, Index export réseau                | kWh    | Énergie prise au réseau, envoyée au réseau         |
| Consommation de la maison, Index de consommation maison | W, kWh | Consommation de la maison mesurée par le compteur  |
| Température de l'onduleur                               | °C     | Température de l'onduleur                          |

Une fonctionnalité vue pour la première fois (une batterie qui se réveille le matin) est proposée
en **Mettre à jour** dans l'onglet Découverte. Une fonctionnalité n'est jamais retirée : une
batterie lue vide la nuit garde ses fonctionnalités.

## Suivi d'énergie

Les index (production, batterie, réseau, maison) sont des compteurs en kWh que le suivi d'énergie
de Gladys transforme en énergie par demi-heure. L'installation et ses onduleurs comptent **la
même production** : pour la production, ajoutez au suivi d'énergie l'installation **ou** ses
onduleurs, pas les deux, sinon elle sera comptée deux fois. Les compteurs Growatt valent parfois 0
ou reculent un peu autour de minuit : l'intégration filtre ces anomalies.

## Widget du tableau de bord

**Vue solaire** : choisissez une installation ou un onduleur dans ses réglages. Il affiche des
tuiles en direct (production, énergie du jour, batterie, import et export réseau, maison), la
courbe de production de la journée et l'état de l'onduleur avec l'heure de ses dernières données.

## Déclencheur de scène

**L'état de l'onduleur a changé** : se déclenche quand un onduleur passe en défaut, ne remonte
plus au cloud Growatt (hors ligne), se met en attente (la nuit) ou fonctionne de nouveau
normalement. Filtres : l'onduleur, le nouvel état. Variables pour les actions : le nouvel état
(code et texte), l'état précédent, le nom de l'onduleur. La première lecture après un démarrage ne
le déclenche jamais.

## Action

**Tester la connexion** (onglet Configuration) : lit le compte et indique les installations et
onduleurs trouvés, les appareils comptés seulement dans les totaux de l'installation, ou la raison
d'un échec. Elle réutilise les données lues il y a moins de 5 minutes : cliquer de nouveau ne
multiplie pas les requêtes vers Growatt.

## Exemples de scènes

- **Prévenir d'un défaut** : déclencheur « L'état de l'onduleur a changé » avec les états En
  défaut et Hors ligne → envoyer le message « L'onduleur {{device_name}} est maintenant
  {{status_label}} ».
- **Profiter du surplus** : toutes les 5 minutes, si la puissance exportée vers le réseau dépasse
  1500 W et le niveau de batterie 90 % → allumer la prise du chauffe-eau.
- **Bilan du soir** : chaque jour à 21 h → envoyer un message avec la production du jour de
  l'installation.

## En cas de problème

- **« Growatt refuse le jeton »** : vérifiez le jeton et la région du serveur. L'intégration
  n'appelle plus Growatt tant que la configuration ne change pas.
- **« Growatt refuse l'identifiant ou le mot de passe »** : vérifiez-les dans l'application
  ShinePhone, ainsi que la région. Aucun nouvel essai tant que la configuration ne change pas,
  pour protéger le compte.
- **« Le serveur Growatt refuse la connexion ShinePhone (HTTP 403) »** : le serveur refuse la
  demande de connexion elle-même, quel que soit le mot de passe. L'intégration attend 6 heures
  avant de réessayer ; utilisez plutôt un jeton OpenAPI.
- **« Growatt a bloqué le compte »** : le serveur ShinePhone a bloqué le compte après trop de
  connexions (les autres applications connectées avec le même compte comptent aussi).
  L'intégration attend 6 heures avant de réessayer, redémarrage compris. Un jeton évite le
  problème.
- **« Le cloud Growatt ne répond pas »** : les relevés reprendront tout seuls.
- **Un onduleur affiche Hors ligne** : son enregistreur ne remonte plus (Wi-Fi, alimentation).
- Pour le détail, réglez la variable `LOG_LEVEL=debug` de l'intégration et consultez ses logs :
  ils ne contiennent jamais le jeton ni le mot de passe.

## Limites

- Développée sans le matériel ni compte Growatt : les noms des champs viennent de la bibliothèque
  growattServer et de l'intégration Home Assistant. Vos retours sont les bienvenus, surtout sur
  les SPH (l'unité de leurs puissances réseau) et sur les états des familles moins courantes.
- Lecture seule : aucun réglage de l'onduleur (charge, décharge, limite d'injection) n'est
  modifiable.
- Les données sont celles du cloud Growatt : au mieux vieilles de 5 minutes, et absentes quand le
  cloud est en panne.
- Données détaillées : MIN / TL-X / MOD / MIC et SPH avec un jeton ; onduleurs string, TL-X et
  SPH avec un compte. Les autres familles (MAX, SPA, stockage, NOAH…) sont seulement dans les
  totaux de l'installation.
- Requêtes par rafraîchissement : avec un jeton, 2 par installation, 1 par MIN, 2 par SPH, et la
  liste des appareils une fois par heure ; avec un compte, 1 ou 2 par installation, 1 par
  onduleur, 2 par SPH.
