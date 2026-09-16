// French changelog. Entries are matched to the English ones by date and
// position (mergeChangelog in lib/changelog-content.js), so keep the dates and
// the order of items inside each date identical to en.js — anything missing
// here falls back to the English original.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: 'La comparaison d’arbres propose les mêmes graphiques que la page de l’arbre',
        text: 'La comparaison de deux généalogistes s’ouvre désormais en sablier — les ascendants et les descendants de la personne correspondante à la fois — et peut être dessinée en <em>éventail</em> ou en <em>arbre</em> classique, avec la même limite de générations. Chaque personne conserve sa couleur de comparaison dans tous les graphiques.',
      },
      {
        title: 'La comparaison téléchargée emporte sa légende',
        text: 'Le téléchargement <strong>SVG</strong> d’une comparaison d’arbres dessine désormais la légende des couleurs sous le graphique, avec le nombre de personnes par groupe. Une comparaison enregistrée ou imprimée se comprend ainsi d’elle-même, sans la page à côté.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'Une seule page d’arbre pour toutes les directions et tous les graphiques',
        text: 'Les vues séparées des ascendants et des descendants sont devenues une unique page <em>Arbre</em>, qui s’ouvre en sablier et montre les deux à la fois. Vous pouvez la restreindre à une seule direction, la limiter à un nombre choisi de générations et télécharger exactement ce que vous voyez en SVG, CSV ou GEDCOM.',
      },
      {
        title: 'Un nouveau graphique en éventail',
        text: 'L’éventail dessine chaque génération comme un anneau de secteurs autour de la personne de départ, avec les dates de mariage sur les bandes intermédiaires — bien plus de personnes à l’écran qu’un arbre classique n’en contient. Lorsque seuls les ascendants ou les descendants sont affichés, il peut se refermer en cercle complet.',
      },
      {
        title: 'Moins de fausses correspondances entre les sources',
        text: 'Les règles qui décident si deux enregistrements désignent la même personne ont été réétalonnées sur des échantillons vérifiés à la main. Des années contradictoires, des dates complètes divergentes, des parents discordants, des noms de remplacement et des décalages de génération écartent désormais une paire, et les sources de cimetières et les registres paroissiaux sont jugés selon des règles qui leur sont propres.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: 'La page d’un généalogiste est organisée par source',
        text: 'Les généalogistes qui contribuent depuis plusieurs sources — leur propre arbre généalogique, l’index Matricula, les cimetières Geneanet, les sources militaires — disposent maintenant d’un onglet pour chacune, et chaque onglet porte ses propres chiffres et son propre nuage de noms.',
      },
      {
        title: 'Chiffres des cimetières Geneanet par généalogiste',
        text: 'Lorsqu’un généalogiste a contribué des relevés de sépultures, sa page indique désormais combien il y en a et cartographie les cimetières dont elles proviennent.',
      },
      {
        title: 'Les nombres se lisent naturellement dans chaque langue',
        text: 'Les nombres de l’interface prennent maintenant la forme grammaticale que la langue exige réellement, y compris le duel slovène et le paucal croate.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'In memoriam',
        text: 'Les généalogistes disparus sont signalés par une bougie à côté de leur nom partout où il apparaît, et leur page porte un encart commémoratif avec leur nom et leurs années. Leur travail reste pleinement disponible dans l’index.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Refonte de la mise en correspondance entre sources',
        text: 'La comparaison qui retrouve la même personne dans les arbres de deux généalogistes a été reconstruite pour la précision, le rappel et la vitesse : elle trouve davantage de recoupements réels, en propose beaucoup moins de faux et recalcule l’index entier bien plus vite.',
      },
      {
        title: 'Les filtres de tableau peuvent demander l’un ou l’autre',
        text: 'Dans n’importe quel champ de filtre, une espace signifie toujours « tous ces mots », mais une virgule signifie désormais « l’un quelconque de ceux-ci » : <em>Ramuta, Simonič</em> trouve les enregistrements portant l’un ou l’autre nom, là où auparavant les deux étaient cherchés ensemble et rien n’était trouvé.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: 'Restreindre à un seul nom les correspondances d’un généalogiste',
        text: 'La liste des généalogistes avec lesquels vous vous recoupez peut être restreinte à un seul nom de famille. Les compteurs se restreignent avec elle et les généalogistes sans correspondance sur ce nom disparaissent : « qui d’autre a ce nom ? » ne demande qu’un champ.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'La page Sources s’ouvre instantanément',
        text: 'Les statistiques, les chiffres de contribution et les compteurs de correspondances derrière l’onglet <em>Sources</em> sont désormais tenus prêts sur le serveur au lieu d’être recalculés à chaque visite.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'Un guide d’utilisation',
        text: 'Un guide complet pour chercher dans l’index et lire les enregistrements est à un clic — depuis le point d’interrogation de la barre supérieure ou le lien en pied de page — et constitue une page à part entière, que l’on peut mettre en favori et partager.',
      },
    ],
  },
];
