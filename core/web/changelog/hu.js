// Hungarian changelog. Entries are matched to the English ones by date and
// position (mergeChangelog in lib/changelog-content.js), so keep the dates and
// the order of items inside each date identical to en.js — anything missing
// here falls back to the English original.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: 'A fák összehasonlítása ugyanazokat a rajzokat kínálja, mint a családfa oldal',
        text: 'Két családfakutató összehasonlítása mostantól homokóra nézetben nyílik meg — egyszerre az egyező személy őseivel és leszármazottaival —, és megrajzolható <em>legyezőként</em> vagy klasszikus <em>faként</em>, ugyanazzal a generációs korláttal. Minden személy mindegyik rajzon megtartja az összehasonlítási színét.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'Egyetlen családfa oldal minden irányhoz és rajzhoz',
        text: 'Az ősök és a leszármazottak külön nézetéből egyetlen <em>Fa</em> oldal lett, amely homokóraként nyílik meg, és egyszerre mutatja mindkettőt. Leszűkíthető egyetlen irányra, korlátozható a kiválasztott számú generációra, és pontosan az tölthető le SVG, CSV vagy GEDCOM formátumban, ami látható.',
      },
      {
        title: 'Új legyező nézet',
        text: 'A legyező minden generációt cikkelyek gyűrűjeként rajzol meg a kiindulási személy köré, a köztük lévő sávokon a házassági dátumokkal — sokkal több ember fér a képernyőre, mint egy klasszikus fára. Ha csak az ősök vagy csak a leszármazottak láthatók, teljes körré zárható.',
      },
      {
        title: 'Kevesebb téves egyezés a források között',
        text: 'A szabályokat, amelyek eldöntik, hogy két bejegyzés ugyanaz a személy-e, kézzel ellenőrzött mintákon hangolták újra. Az egymásnak ellentmondó évek, az eltérő teljes dátumok, a nem egyező szülők, a helykitöltő nevek és a generációs csúszások mostantól kizárnak egy párt, a temetői és az anyakönyvi forrásokat pedig saját szabályok szerint ítéli meg a rendszer.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: 'A családfakutató oldala források szerint rendezett',
        text: 'Azok a családfakutatók, akik több forrásból is hozzájárulnak — saját családfájukból, a Matricula indexből, a Geneanet temetőkből, katonai forrásokból —, mostantól mindegyikhez külön fület kapnak, és minden fül a saját adatait és névfelhőjét hordozza.',
      },
      {
        title: 'Geneanet temetői adatok családfakutatónként',
        text: 'Ahol egy családfakutató sírbejegyzésekkel járult hozzá, az oldalán mostantól látszik, hány van belőlük, és térképen is megjelennek a temetők, ahonnan származnak.',
      },
      {
        title: 'A számok minden nyelven természetesen olvashatók',
        text: 'A felület számai mostantól azt a nyelvtani alakot veszik fel, amelyet az adott nyelv valóban megkíván, beleértve a szlovén kettes számot és a horvát paukált is.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'In memoriam',
        text: 'Az elhunyt családfakutatók nevét mindenütt gyertya jelöli, ahol csak megjelenik, az oldalukon pedig emlékező szövegdoboz áll a nevükkel és évszámaikkal. Munkájuk teljes egészében elérhető marad az indexben.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Megújult a források közötti egyeztetés',
        text: 'Az az összevetés, amely két családfakutató fájában megtalálja ugyanazt a személyt, a pontosság, a teljesség és a sebesség jegyében épült újra: több valódi átfedést talál, jóval kevesebb hibásat javasol, és sokkal gyorsabban számolja újra a teljes indexet.',
      },
      {
        title: 'A táblázatszűrők rákérdezhetnek az egyikre vagy a másikra',
        text: 'Bármelyik szűrőmezőben a szóköz továbbra is azt jelenti, hogy „mindezek a szavak”, a vessző viszont mostantól azt, hogy „bármelyik ezek közül”: a <em>Ramuta, Simonič</em> mindkét vezetéknév bármelyikét tartalmazó bejegyzéseket megtalálja, míg korábban egyszerre kereste mindkettőt, és nem talált semmit.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: 'Egy családfakutató egyezéseinek leszűkítése egyetlen vezetéknévre',
        text: 'Azoknak a családfakutatóknak a listája, akikkel átfedésben van, leszűkíthető egyetlen vezetéknévre. A számok is vele együtt szűkülnek, és kiesnek azok a családfakutatók, akiknél nincs egyezés arra a névre, így a „ki másnak van még ez a neve?” kérdés egyetlen mezőnyire van.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'A Források oldal azonnal megnyílik',
        text: 'A <em>Források</em> fül mögötti statisztikák, hozzájárulási adatok és egyezésszámok mostantól előkészítve állnak a kiszolgálón ahelyett, hogy minden látogatáskor újraszámolódnának.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'Felhasználói kézikönyv',
        text: 'Az index kereséséhez és a bejegyzések olvasásához készült teljes útmutató egyetlen kattintásra van — a felső sáv kérdőjelénél vagy a lábléc hivatkozásánál —, és önálló oldal, így könyvjelzőzhető és megosztható.',
      },
    ],
  },
];
