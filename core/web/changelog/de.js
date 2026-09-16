// German changelog. Entries are matched to the English ones by date and
// position (mergeChangelog in lib/changelog-content.js), so keep the dates and
// the order of items inside each date identical to en.js — anything missing
// here falls back to the English original.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: 'Der Stammbaum-Vergleich kennt dieselben Darstellungen wie die Stammbaum-Seite',
        text: 'Der Vergleich zweier Genealogen öffnet sich nun als Sanduhr — mit den Vorfahren und den Nachkommen der übereinstimmenden Person zugleich — und lässt sich als <em>Fächer</em> oder als klassischer <em>Baum</em> zeichnen, mit derselben Generationengrenze. Jede Person behält in allen Darstellungen ihre Vergleichsfarbe.',
      },
      {
        title: 'Der heruntergeladene Vergleich bringt seine Legende mit',
        text: 'Der <strong>SVG</strong>-Download eines Stammbaum-Vergleichs zeichnet die Farblegende nun unter die Darstellung, mit der Anzahl je Gruppe. Ein gespeicherter oder gedruckter Vergleich erklärt sich damit von selbst, auch ohne die Seite daneben.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'Eine Stammbaum-Seite für jede Richtung und jede Darstellung',
        text: 'Aus den getrennten Ansichten für Vorfahren und Nachkommen ist eine einzige <em>Baum</em>-Seite geworden, die sich als Sanduhr öffnet und beides zugleich zeigt. Sie lässt sich auf eine Richtung einschränken, auf eine gewählte Anzahl Generationen begrenzen und genau so, wie sie zu sehen ist, als SVG, CSV oder GEDCOM herunterladen.',
      },
      {
        title: 'Eine neue Fächerdarstellung',
        text: 'Der Fächer zeichnet jede Generation als Ring von Segmenten um die Ausgangsperson, mit den Heiratsdaten auf den Bändern dazwischen — deutlich mehr Personen auf dem Bildschirm, als in einen klassischen Baum passen. Werden nur Vorfahren oder nur Nachkommen gezeigt, lässt er sich zu einem vollen Kreis schließen.',
      },
      {
        title: 'Weniger falsche Übereinstimmungen zwischen Quellen',
        text: 'Die Regeln, die entscheiden, ob zwei Einträge dieselbe Person sind, wurden an handgeprüften Stichproben neu justiert. Widersprüchliche Jahre, abweichende vollständige Daten, nicht übereinstimmende Eltern, Platzhalternamen und Generationsversätze schließen ein Paar nun aus, und Friedhofs- und Matrikelquellen werden nach eigenen Regeln beurteilt.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: 'Die Seite eines Genealogen ist nach Quellen gegliedert',
        text: 'Genealogen, die aus mehreren Quellen beitragen — dem eigenen Stammbaum, dem Matricula-Index, Geneanet-Friedhöfen, Militärquellen — erhalten nun für jede einen eigenen Reiter, und jeder Reiter trägt seine eigenen Zahlen und seine eigene Nachnamenwolke.',
      },
      {
        title: 'Geneanet-Friedhofszahlen je Genealoge',
        text: 'Wo ein Genealoge Grabeinträge beigetragen hat, zeigt seine Seite nun, wie viele es sind, und kartiert die Friedhöfe, aus denen sie stammen.',
      },
      {
        title: 'Zahlen lesen sich in jeder Sprache natürlich',
        text: 'Zahlen in der Oberfläche nehmen jetzt die grammatische Form an, die die jeweilige Sprache tatsächlich verlangt, einschließlich des slowenischen Duals und des kroatischen Paukals.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'In memoriam',
        text: 'Verstorbene Genealogen sind überall, wo ihr Name erscheint, mit einer Kerze gekennzeichnet, und ihre Seite trägt eine Gedenktafel mit Namen und Lebensjahren. Ihre Arbeit bleibt im Index vollständig verfügbar.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Der Abgleich zwischen Quellen wurde überarbeitet',
        text: 'Der Vergleich, der dieselbe Person in den Bäumen zweier Genealogen findet, wurde auf Genauigkeit, Vollständigkeit und Geschwindigkeit hin neu gebaut: Er findet mehr echte Überschneidungen, schlägt weit weniger falsche vor und berechnet den gesamten Index erheblich schneller neu.',
      },
      {
        title: 'Tabellenfilter können nach dem einen oder dem anderen fragen',
        text: 'In jedem Filterfeld bedeutet ein Leerzeichen weiterhin „alle diese Wörter“, ein Komma nun aber „eines davon“: <em>Ramuta, Simonič</em> findet Einträge mit einem der beiden Nachnamen, während zuvor beide zugleich gesucht wurden und nichts gefunden wurde.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: 'Die Übereinstimmungen eines Genealogen auf einen Nachnamen eingrenzen',
        text: 'Die Liste der Genealogen, mit denen Sie sich überschneiden, lässt sich auf einen einzigen Nachnamen eingrenzen. Die Zahlen grenzen sich mit ein, und Genealogen ohne Übereinstimmung bei diesem Namen fallen heraus, sodass „wer hat diesen Namen noch?“ nur ein Feld entfernt ist.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'Die Seite Quellen öffnet sich sofort',
        text: 'Die Statistiken, Beitragszahlen und Übereinstimmungszahlen hinter dem Reiter <em>Quellen</em> werden nun auf dem Server vorgehalten, statt bei jedem Besuch neu berechnet zu werden.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'Ein Benutzerhandbuch',
        text: 'Eine vollständige Anleitung zum Suchen im Index und zum Lesen der Einträge ist einen Klick entfernt — beim Fragezeichen in der oberen Leiste oder beim Link in der Fußzeile — und ist eine eigene Seite, die sich als Lesezeichen speichern und weitergeben lässt.',
      },
    ],
  },
];
