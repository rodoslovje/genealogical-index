// Croatian changelog. Entries are matched to the English ones by date and
// position (mergeChangelog in lib/changelog-content.js), so keep the dates and
// the order of items inside each date identical to en.js — anything missing
// here falls back to the English original.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: 'Usporedba stabala poznaje iste prikaze kao i stranica sa stablom',
        text: 'Usporedba dvaju rodoslovaca sada se otvara kao leptir — istodobno s precima i potomcima podudarne osobe — a može se nacrtati kao <em>lepeza</em> ili klasično <em>stablo</em>, uz isto ograničenje generacija. Svaka osoba u svim prikazima zadržava svoju boju usporedbe.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'Jedna stranica s rodoslovnim stablom za sve smjerove i prikaze',
        text: 'Odvojeni prikazi predaka i potomaka postali su jedna jedina stranica <em>Stablo</em>, koja se otvara kao leptir i prikazuje oboje odjednom. Možete je ograničiti na jedan smjer, ograničiti na odabrani broj generacija i preuzeti točno ono što vidite kao SVG, CSV ili GEDCOM.',
      },
      {
        title: 'Novi prikaz lepezom',
        text: 'Lepeza crta svaku generaciju kao prsten isječaka oko ishodišne osobe, s datumima vjenčanja na pojasevima između njih — na zaslon stane znatno više ljudi nego u klasično stablo. Kada su prikazani samo preci ili samo potomci, može se zatvoriti u puni krug.',
      },
      {
        title: 'Manje lažnih podudaranja među izvorima',
        text: 'Pravila koja odlučuju jesu li dva zapisa ista osoba ponovno su ugođena na ručno provjerenim uzorcima. Proturječne godine, različiti puni datumi, nepodudarni roditelji, zamjenska imena i generacijski pomaci sada isključuju par, a groblja i matične knjige prosuđuju se po vlastitim pravilima.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: 'Stranica rodoslovca uređena je po izvorima',
        text: 'Rodoslovci koji doprinose iz više izvora — vlastitog rodoslovnog stabla, indeksa Matricula, groblja Geneanet, vojnih izvora — sada za svaki dobivaju zasebnu karticu, a svaka kartica nosi vlastite podatke i oblak prezimena.',
      },
      {
        title: 'Podaci o grobljima Geneanet po rodoslovcu',
        text: 'Ondje gdje je rodoslovac pridonio zapise o grobovima, na njegovoj se stranici sada vidi koliko ih je i karta groblja s kojih potječu.',
      },
      {
        title: 'Brojevi se čitaju prirodno na svakom jeziku',
        text: 'Brojevi u sučelju sada poprimaju gramatički oblik koji jezik doista traži, uključujući slovensku dvojinu i hrvatski paukal.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'U spomen',
        text: 'Rodoslovci koji su preminuli označeni su svijećom uz ime gdje god se ono pojavi, a na njihovoj je stranici spomen-zapis s imenom i godinama. Njihov rad ostaje u cijelosti dostupan u indeksu.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Obnovljeno podudaranje među izvorima',
        text: 'Usporedba koja pronalazi istu osobu u stablima dvaju rodoslovaca obnovljena je radi preciznosti, odziva i brzine: pronalazi više stvarnih preklapanja, predlaže znatno manje pogrešnih i mnogo brže preračunava cijeli indeks.',
      },
      {
        title: 'Filtri tablica mogu tražiti jedno ili drugo',
        text: 'U bilo kojem polju filtra razmak i dalje znači „sve ove riječi”, a zarez sada znači „bilo koju od ovih”: <em>Ramuta, Simonič</em> pronalazi zapise s bilo kojim od dvaju prezimena, dok je prije tražio oba odjednom i nije pronalazio ništa.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: 'Ograničite podudaranja rodoslovca na jedno prezime',
        text: 'Popis rodoslovaca s kojima se preklapate možete ograničiti na jedno jedino prezime. Brojevi se ograničavaju zajedno s njim, a rodoslovci bez podudaranja na tom prezimenu ispadaju, pa je pitanje „tko još ima ovo prezime?” udaljeno jedno polje.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'Stranica Izvori otvara se odmah',
        text: 'Statistika, podaci o doprinosima i brojevi podudaranja iza kartice <em>Izvori</em> sada se na poslužitelju drže pripremljenima umjesto da se pri svakom posjetu iznova izračunavaju.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'Upute za korištenje',
        text: 'Cjelovite upute za pretraživanje indeksa i čitanje zapisa udaljene su jedan klik — kod upitnika u gornjoj traci ili poveznice u podnožju — i zasebna su stranica, pa ih možete spremiti u zabilješke ili podijeliti s drugima.',
      },
    ],
  },
];
