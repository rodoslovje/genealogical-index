// Slovenian changelog. Entries are matched to the English ones by date and
// position (mergeChangelog in lib/changelog-content.js), so keep the dates and
// the order of items inside each date identical to en.js — anything missing
// here falls back to the English original.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: 'Primerjava dreves pozna enake prikaze kot stran z drevesom',
        text: 'Primerjava dveh rodoslovcev se zdaj odpre kot metuljček — hkrati s predniki in potomci ujemajoče se osebe — nariše pa se lahko kot <em>pahljača</em> ali klasično <em>drevo</em>, z enako omejitvijo generacij. Vsaka oseba v vseh prikazih ohrani svojo barvo primerjave.',
      },
      {
        title: 'Prenesena primerjava s seboj nosi legendo',
        text: 'Prenos primerjave dreves v obliki <strong>SVG</strong> zdaj pod prikaz izriše še barvno legendo s številom oseb v vsaki skupini. Shranjena ali natisnjena primerjava tako govori sama zase, tudi brez strani ob njej.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'Ena stran z rodovniškim drevesom za vse smeri in prikaze',
        text: 'Ločena prikaza prednikov in potomcev sta postala ena sama stran <em>Drevo</em>, ki se odpre kot metuljček in prikaže oboje hkrati. Omejite ga lahko na eno smer, omejite na izbrano število generacij in prenesete natanko to, kar vidite, kot SVG, CSV ali GEDCOM.',
      },
      {
        title: 'Nov prikaz s pahljačo',
        text: 'Pahljača nariše vsako generacijo kot obroč izsekov okrog izhodiščne osebe, z datumi porok na vmesnih pasovih — na zaslon spravi precej več ljudi kot klasično drevo. Kadar so prikazani samo predniki ali samo potomci, se lahko sklene v polni krog.',
      },
      {
        title: 'Manj napačnih ujemanj med viri',
        text: 'Pravila, ki odločajo, ali sta dva zapisa ista oseba, so bila znova umerjena na ročno pregledanih vzorcih. Nasprotujoča si leta, različni polni datumi, neujemajoči se starši, nadomestna imena in generacijski zamiki par zdaj izločijo, pokopališki in matični viri pa se presojajo po svojih pravilih.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: 'Stran rodoslovca je urejena po virih',
        text: 'Rodoslovci, ki prispevajo iz več virov — lastnega rodovniškega drevesa, indeksa Matricula, pokopališč Geneanet, vojaških virov — imajo zdaj za vsakega svoj zavihek, vsak zavihek pa svoje podatke in oblak priimkov.',
      },
      {
        title: 'Podatki o pokopališčih Geneanet po rodoslovcih',
        text: 'Kadar je rodoslovec prispeval zapise o grobovih, je na njegovi strani zdaj prikazano, koliko jih je, in zemljevid pokopališč, s katerih izvirajo.',
      },
      {
        title: 'Števila se berejo naravno v vseh jezikih',
        text: 'Števila v vmesniku zdaj privzamejo slovnično obliko, ki jo jezik dejansko zahteva, vključno s slovensko dvojino in hrvaškim paukalom.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'V spomin',
        text: 'Rodoslovci, ki so preminuli, so povsod, kjer se pojavi njihovo ime, označeni s svečko, na njihovi strani pa je spominski zapis z imenom in letnicami. Njihovo delo ostaja v indeksu v celoti na voljo.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Prenovljeno ujemanje med viri',
        text: 'Primerjava, ki poišče isto osebo v drevesih dveh rodoslovcev, je bila prenovljena glede natančnosti, priklica in hitrosti: najde več resničnih prekrivanj, predlaga bistveno manj napačnih in znatno hitreje preračuna celoten indeks.',
      },
      {
        title: 'Filtri tabel lahko vprašajo po enem ali drugem',
        text: 'V katerem koli filtrirnem polju presledek še vedno pomeni »vse te besede«, vejica pa zdaj pomeni »katero koli od teh«: <em>Ramuta, Simonič</em> najde zapise s katerim koli od obeh priimkov, prej pa je iskal oba hkrati in ni našel ničesar.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: 'Omejite ujemanja rodoslovca na en priimek',
        text: 'Seznam rodoslovcev, s katerimi se prekrivate, lahko omejite na en sam priimek. Števila se omejijo z njim, rodoslovci brez ujemanja pri tem priimku pa izpadejo, tako da je vprašanje »kdo še ima ta priimek?« oddaljeno eno polje.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'Stran Viri se odpre takoj',
        text: 'Statistika, podatki o prispevkih in števila ujemanj za zavihkom <em>Viri</em> so zdaj na strežniku pripravljeni vnaprej, namesto da bi se ob vsakem obisku izračunali znova.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'Navodila za uporabo',
        text: 'Celotna navodila za iskanje po indeksu in branje zapisov so en klik stran — pri vprašaju v zgornji vrstici ali pri povezavi v nogi — in so samostojna stran, ki jo lahko shranite med zaznamke ali delite z drugimi.',
      },
    ],
  },
];
