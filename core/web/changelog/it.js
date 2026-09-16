// Italian changelog. Entries are matched to the English ones by date and
// position (mergeChangelog in lib/changelog-content.js), so keep the dates and
// the order of items inside each date identical to en.js — anything missing
// here falls back to the English original.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: "Il confronto degli alberi usa gli stessi grafici della pagina dell'albero",
        text: 'Il confronto fra due genealogisti si apre ora come una clessidra — con gli antenati e i discendenti della persona corrispondente insieme — e può essere disegnato come <em>ventaglio</em> o come <em>albero</em> classico, con lo stesso limite di generazioni. Ogni persona mantiene il proprio colore di confronto in tutti i grafici.',
      },
      {
        title: 'Il confronto scaricato porta con sé la legenda',
        text: 'Il download in <strong>SVG</strong> di un confronto fra alberi disegna ora la legenda dei colori sotto il grafico, con il numero di persone per ogni gruppo. Un confronto salvato o stampato si spiega così da solo, anche senza la pagina accanto.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'Una sola pagina dell’albero per ogni direzione e ogni grafico',
        text: 'Le viste separate di antenati e discendenti sono diventate un’unica pagina <em>Albero</em>, che si apre come clessidra e mostra entrambi insieme. Si può restringere a una sola direzione, limitare a un numero scelto di generazioni e scaricare esattamente ciò che si vede come SVG, CSV o GEDCOM.',
      },
      {
        title: 'Un nuovo grafico a ventaglio',
        text: 'Il ventaglio disegna ogni generazione come un anello di spicchi attorno alla persona di partenza, con le date di matrimonio sulle fasce intermedie: sullo schermo entrano molte più persone di quante ne contenga un albero classico. Mostrando solo gli antenati o solo i discendenti, può chiudersi in un cerchio completo.',
      },
      {
        title: 'Meno corrispondenze errate fra le fonti',
        text: 'Le regole che decidono se due record sono la stessa persona sono state ritarate su campioni verificati a mano. Anni contraddittori, date complete discordanti, genitori non corrispondenti, nomi segnaposto e scarti di generazione ora escludono una coppia, e le fonti cimiteriali e i registri parrocchiali sono giudicati con regole proprie.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: 'La pagina di un genealogista è organizzata per fonte',
        text: 'I genealogisti che contribuiscono da più fonti — il proprio albero genealogico, l’indice Matricula, i cimiteri Geneanet, le fonti militari — hanno ora una scheda per ciascuna, e ogni scheda porta i propri dati e la propria nuvola di cognomi.',
      },
      {
        title: 'Dati sui cimiteri Geneanet per genealogista',
        text: 'Dove un genealogista ha contribuito con registrazioni di sepolture, la sua pagina mostra ora quante sono e mappa i cimiteri da cui provengono.',
      },
      {
        title: 'I numeri si leggono in modo naturale in ogni lingua',
        text: 'I numeri nell’interfaccia assumono ora la forma grammaticale che la lingua richiede davvero, compresi il duale sloveno e il paucale croato.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'In memoriam',
        text: 'I genealogisti scomparsi sono contrassegnati da una candela accanto al nome ovunque esso compaia, e la loro pagina porta un riquadro commemorativo con il nome e gli anni. Il loro lavoro resta pienamente disponibile nell’indice.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Rinnovato il confronto fra le fonti',
        text: 'Il confronto che individua la stessa persona negli alberi di due genealogisti è stato ricostruito per precisione, completezza e velocità: trova più sovrapposizioni reali, ne propone molte meno sbagliate e ricalcola l’intero indice assai più rapidamente.',
      },
      {
        title: 'I filtri delle tabelle possono chiedere l’uno o l’altro',
        text: 'In qualsiasi campo di filtro uno spazio significa ancora «tutte queste parole», ma una virgola significa ora «una qualsiasi di queste»: <em>Ramuta, Simonič</em> trova i record con l’uno o l’altro cognome, mentre prima li cercava entrambi insieme e non trovava nulla.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: 'Restringere a un cognome le corrispondenze di un genealogista',
        text: 'L’elenco dei genealogisti con cui ci si sovrappone può essere ristretto a un solo cognome. I conteggi si restringono con esso e i genealogisti senza corrispondenze su quel cognome scompaiono, così «chi altro ha questo cognome?» dista un campo.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'La pagina Fonti si apre all’istante',
        text: 'Le statistiche, i dati sui contributi e i conteggi delle corrispondenze dietro la scheda <em>Fonti</em> sono ora tenuti pronti sul server invece di essere ricalcolati a ogni visita.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'Una guida utente',
        text: 'Una guida completa alla ricerca nell’indice e alla lettura dei record dista un clic — dal punto interrogativo nella barra superiore o dal collegamento a piè di pagina — ed è una pagina a sé, quindi può essere aggiunta ai segnalibri e condivisa.',
      },
    ],
  },
];
