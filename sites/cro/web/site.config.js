/**
 * Croatian site configuration.
 * This is the only file that differs between installations.
 * Fork this file (and the public/ assets) to create a new country site.
 */
const siteConfig = {
  // Branding
  logo:        '/hrd-logo.png',
  logoAlt:     'Hrvatsko rodoslovno društvo “Pavao Ritter Vitezović”',
  societyUrl:  'https://www.rodoslovlje.hr',
  indexUrl:    null,
  contactEmail: 'rodoslovlje@rodoslovlje.hr',

  apiHost: 'indeks-api.rodoslovlje.hr',
  authUrl: null,
  filePrefix: 'cgi',

  // Languages shown in the dropdown, ordered alphabetically by language name
  languages: ['de', 'en', 'hr', 'hu', 'it', 'sl'],

  // Preferred language when no saved preference or browser match is found
  defaultLang: 'hr',

  // Per-language overrides: site title and society name
  i18n: {
    en: { site_title: 'Croatian Genealogical Index',      society_name: 'Croatian Genealogy Society “Pavao Ritter Vitezović”' },
    sl: { site_title: 'Hrvaški rodoslovni indeks',        society_name: 'Hrvaško rodoslovno društvo “Pavao Ritter Vitezović”' },
    hr: { site_title: 'Hrvatski rodoslovni indeks',       society_name: 'Hrvatsko rodoslovno društvo “Pavao Ritter Vitezović”' },
    hu: { site_title: 'Horvát Genealógiai Index',         society_name: '”Pavao Ritter Vitezović” Horvát Genealógiai Társaság' },
    de: { site_title: 'Kroatischer Genealogischer Index', society_name: 'Kroatische Genealogische Gesellschaft “Pavao Ritter Vitezović”' },
    it: { site_title: 'Indice genealogico croato',        society_name: 'Società genealogica croata “Pavao Ritter Vitezović”' },
  },

  // Intro paragraphs shown on empty search tabs. Falls back to 'en' for missing languages.
  // Each entry: { text: string (HTML allowed), warning?: true }
  intro: {
    en: [
      { text: '<strong>The Croatian Genealogical Index</strong> is an archival collection of data on persons and families in Croatia, built from the collections of individual genealogists. In it you can search for the names and surnames of the people you are researching, to find out whether someone else may have already discovered and described them. The basic index contains personal names, dates and places of birth, marriage and death, as well as links to parents, partners and children. Each record also includes the surname of the contributing genealogist, which lets the researcher make further contact, points the way, and often makes research possible in a parish discovered indirectly. The contact details of the genealogists are not published, but they will not be difficult to reach through the <a href="https://www.rodoslovlje.hr" target="_blank" rel="noopener">Croatian Genealogy Society "Pavao Ritter Vitezović"</a>.' },
      { text: 'The application offers advanced search, sorting, and data export options. For detailed instructions on using all features, please see the <a href="#" onclick="document.getElementById(\'help-toggle-btn\')?.click(); return false;">user manual</a>.' },
      { text: 'The family index can also include parents who never married or even never lived together &ndash; valuable information for descendants and other researchers.' },
      { text: 'The index is built from data in GEDCOM files contributed by many genealogists, listed on the <a href="?t=contributors">Genealogists</a> page.' },
      { text: 'Warning! The Croatian Genealogical Index is for informational purposes only. The Croatian Genealogy Society "Pavao Ritter Vitezović" disclaims all responsibility for the accuracy of the data submitted. The society is a voluntary association of individuals who develop a shared knowledge source drawn from parish registers and other written and oral sources. Its structure allows anyone with their own collection of genealogical data to add it to the shared combined collection and index. Neither the individual contributors nor the Croatian Genealogy Society "Pavao Ritter Vitezović" can guarantee the accuracy of the data.', warning: true },
      { text: 'If you keep your own family tree in a database and would like to join the existing contributors with the results of your work, export the data to a GEDCOM file (without data on living persons) and send it to the administrator by <a href="mailto:rodoslovlje@rodoslovlje.hr">email</a>.' },
    ],
    sl: [
      { text: '<strong>Hrvatski rodoslovni indeks</strong> je arhivska zbirka podatkov o osebah in družinah na Hrvaškem, ki nastaja iz zbirk posameznih rodoslovcev. V njej lahko poiščete imena in priimke oseb, ki jih raziskujete, da bi ugotovili, ali jih je morda odkril in popisal že kdo drug. Osnovni indeks vsebuje osebna imena, datume in kraje rojstev, porok in smrti, prav tako pa tudi povezave do staršev, partnerjev in otrok. Pri vsakem zapisu je tudi priimek rodoslovca &ndash; dajalca podatkov, kar iskalcu omogoči nadaljnji stik, nakaže smer in pogosto sploh omogoči nadaljnje raziskovanje v posredno odkriti župniji. Kontaktni podatki rodoslovcev sicer niso objavljeni, vendar do njih ne bo težko priti prek <a href="https://www.rodoslovlje.hr" target="_blank" rel="noopener">Hrvaškega rodoslovnega društva »Pavao Ritter Vitezović«</a>.' },
      { text: 'Aplikacija ponuja napredne možnosti iskanja, razvrščanja in izvoza podatkov. Za podrobnejša navodila o uporabi vseh funkcionalnosti si oglejte <a href="#" onclick="document.getElementById(\'help-toggle-btn\')?.click(); return false;">navodila za uporabo</a>.' },
      { text: 'Indeks družin lahko vsebuje tudi starše, ki nikoli niso bili poročeni ali celo nikoli niso živeli skupaj, kar je lahko dragocen podatek za potomce oziroma iskalce informacij.' },
      { text: 'Indeks je sestavljen iz podatkov v datotekah GEDCOM, ki so nam jih posredovali številni rodoslovci, navedeni na strani <a href="?t=contributors">Rodoslovci</a>.' },
      { text: 'Opozorilo! Hrvatski rodoslovni indeks je informativnega značaja. Hrvaško rodoslovno društvo »Pavao Ritter Vitezović« se odreka vsakršni odgovornosti za pravilnost posredovanih podatkov. Društvo je prostovoljna povezava posameznikov, ki razvijajo skupni vir znanja o podatkih iz matičnih registrov ter drugih pisnih in ustnih virov. Struktura društva omogoča, da lahko vsak, ki ima svojo zbirko rodoslovnih podatkov, to prispeva v skupno združeno zbirko in indeks. Za pravilnost podatkov ne jamči niti posameznik, ki jih je prispeval, niti Hrvaško rodoslovno društvo »Pavao Ritter Vitezović«.', warning: true },
      { text: 'Če imate svoj rodovnik v obliki zbirke podatkov in bi se z rezultati svojega dela radi pridružili dosedanjim sodelavcem, izvozite podatke v datoteko GEDCOM (brez podatkov o še živih osebah) in jo po <a href="mailto:rodoslovlje@rodoslovlje.hr">e-pošti</a> pošljite administratorju.' },
    ],
    hr: [
      { text: '<strong>Hrvatski rodoslovni indeks</strong> arhivska je zbirka podataka o osobama i obiteljima u Hrvatskoj, koja nastaje iz zbirki pojedinih rodoslovaca. U njoj možete tražiti imena i prezimena osoba koje istražujete kako biste saznali je li ih netko drugi već otkrio i opisao. Osnovni indeks sadrži osobna imena, datume i mjesta rođenja, vjenčanja i smrti te poveznice na roditelje, partnere i djecu. Uz svaki zapis stoji i prezime rodoslovca &ndash; davatelja podataka, što istraživaču omogućuje daljnji kontakt, naznačuje smjer i nerijetko tek omogućuje daljnje istraživanje u neizravno otkrivenoj župi. Kontaktni podaci rodoslovaca nisu objavljeni, no do njih neće biti teško doći putem <a href="https://www.rodoslovlje.hr" target="_blank" rel="noopener">Hrvatskog rodoslovnog društva "Pavao Ritter Vitezović"</a>.' },
      { text: 'Aplikacija nudi napredne mogućnosti pretraživanja, sortiranja i izvoza podataka. Za detaljnije upute o korištenju svih funkcionalnosti pogledajte <a href="#" onclick="document.getElementById(\'help-toggle-btn\')?.click(); return false;">upute za korištenje</a>.' },
      { text: 'Indeks obitelji može uključivati i roditelje koji se nikada nisu vjenčali ili čak nikada nisu živjeli zajedno, što može biti dragocjen podatak za potomke ili druge istraživače.' },
      { text: 'Indeks je sastavljen od podataka iz datoteka GEDCOM koje su nam ustupili brojni rodoslovci, navedeni na stranici <a href="?t=contributors">Rodoslovci</a>.' },
      { text: 'Upozorenje! Hrvatski rodoslovni indeks ima isključivo informativan karakter. Hrvatsko rodoslovno društvo "Pavao Ritter Vitezović" odriče se svake odgovornosti za točnost dostavljenih podataka. Društvo je dobrovoljno udruženje pojedinaca koji razvijaju zajednički izvor znanja o podacima iz matičnih knjiga te drugih pisanih i usmenih izvora. Struktura društva omogućuje svakome tko ima vlastitu zbirku rodoslovnih podataka da je pridruži zajedničkoj objedinjenoj zbirci i indeksu. Za točnost podataka ne jamči ni pojedinac koji ih je dao ni Hrvatsko rodoslovno društvo "Pavao Ritter Vitezović".', warning: true },
      { text: 'Ako imate vlastito obiteljsko stablo u obliku baze podataka i sa svojim radom želite se pridružiti dosadašnjim suradnicima, izvezite podatke u datoteku GEDCOM (bez podataka o živim osobama) i pošaljite je administratoru <a href="mailto:rodoslovlje@rodoslovlje.hr">e-poštom</a>.' },
    ],
    hu: [
      { text: '<strong>A Horvát Genealógiai Index</strong> horvátországi személyek és családok adatainak archív gyűjteménye, amely az egyes genealógusok gyűjteményeiből épül fel. Itt rákereshet azoknak a személyeknek a nevére és vezetéknevére, akiket kutat, hogy megtudja, valaki más már felfedezte és leírta-e őket. Az alapindex személyneveket, születési, házassági és halálozási dátumokat és helyszíneket tartalmaz, valamint a szülőkre, partnerekre és gyermekekre mutató hivatkozásokat. Minden bejegyzéshez tartozik az adatszolgáltató genealógus vezetékneve is, ami lehetővé teszi a további kapcsolatfelvételt, irányt mutat, és sokszor egyáltalán lehetővé teszi a közvetve felfedezett plébánián való kutatást. A genealógusok elérhetőségei nincsenek közzétéve, de a <a href="https://www.rodoslovlje.hr" target="_blank" rel="noopener">„Pavao Ritter Vitezović" Horvát Genealógiai Társaságon</a> keresztül nem lesz nehéz eljutni hozzájuk.' },
      { text: 'Az alkalmazás fejlett keresési, rendezési és adatexportálási lehetőségeket kínál. Az összes funkció használatára vonatkozó részletes utasításokért tekintse meg a <a href="#" onclick="document.getElementById(\'help-toggle-btn\')?.click(); return false;">használati útmutatót</a>.' },
      { text: 'A családindex olyan szülőket is tartalmazhat, akik soha nem házasodtak össze, vagy akár soha nem is éltek együtt &ndash; ez értékes információ lehet a leszármazottak vagy más kutatók számára.' },
      { text: 'Az index a GEDCOM-fájlokban található adatokból áll össze, amelyeket számos genealógus küldött el nekünk; ők a <a href="?t=contributors">Genealógusok</a> oldalon vannak felsorolva.' },
      { text: 'Figyelmeztetés! A Horvát Genealógiai Index kizárólag tájékoztató jellegű. A „Pavao Ritter Vitezović" Horvát Genealógiai Társaság minden felelősséget elhárít a benyújtott adatok pontosságáért. A társaság olyan egyének önkéntes egyesülete, akik közösen fejlesztik az anyakönyvekből és más írott és szóbeli forrásokból származó adatok közös tudásforrását. A társaság felépítése lehetővé teszi, hogy mindenki, akinek saját genealógiai adatgyűjteménye van, hozzájáruljon vele a közös egyesített gyűjteményhez és indexhez. Az adatok pontosságáért sem az adatokat hozzájáruló egyén, sem a „Pavao Ritter Vitezović" Horvát Genealógiai Társaság nem vállal felelősséget.', warning: true },
      { text: 'Ha saját családfáját adatbázis formájában tárolja, és szeretne a meglévő közreműködőkhöz csatlakozni munkája eredményével, exportálja az adatokat GEDCOM-fájlba (élő személyek adatai nélkül), és küldje el a rendszergazdának <a href="mailto:rodoslovlje@rodoslovlje.hr">e-mailben</a>.' },
    ],
    de: [
      { text: '<strong>Der Kroatische Genealogische Index</strong> ist eine Archivsammlung von Daten über Personen und Familien in Kroatien, die aus den Sammlungen einzelner Genealogen entsteht. Darin können Sie nach Namen und Nachnamen der Personen suchen, die Sie erforschen, um herauszufinden, ob sie bereits jemand anderes entdeckt und beschrieben hat. Der Grundindex enthält Personennamen, Daten und Orte von Geburten, Heiraten und Sterbefällen sowie Verweise auf Eltern, Partner und Kinder. Zu jedem Eintrag gehört auch der Nachname des datenliefernden Genealogen, was dem Forscher die weitere Kontaktaufnahme erlaubt, die Richtung weist und oft überhaupt erst die Recherche in einer indirekt entdeckten Pfarrei ermöglicht. Die Kontaktdaten der Genealogen sind nicht veröffentlicht, doch dürfte es nicht schwerfallen, sie über die <a href="https://www.rodoslovlje.hr" target="_blank" rel="noopener">Kroatische Genealogische Gesellschaft „Pavao Ritter Vitezović"</a> zu erreichen.' },
      { text: 'Die Anwendung bietet erweiterte Such-, Sortier- und Datenexportoptionen. Für detaillierte Anweisungen zur Nutzung aller Funktionen lesen Sie bitte das <a href="#" onclick="document.getElementById(\'help-toggle-btn\')?.click(); return false;">Benutzerhandbuch</a>.' },
      { text: 'Der Familienindex kann auch Eltern enthalten, die nie geheiratet oder sogar nie zusammengelebt haben &ndash; eine wertvolle Information für Nachkommen und andere Forschende.' },
      { text: 'Der Index entsteht aus Daten in GEDCOM-Dateien, die uns zahlreiche Genealogen zur Verfügung gestellt haben; sie sind auf der Seite <a href="?t=contributors">Genealogen</a> aufgeführt.' },
      { text: 'Warnung! Der Kroatische Genealogische Index dient ausschließlich Informationszwecken. Die Kroatische Genealogische Gesellschaft „Pavao Ritter Vitezović" lehnt jegliche Verantwortung für die Richtigkeit der übermittelten Daten ab. Die Gesellschaft ist ein freiwilliger Zusammenschluss von Einzelpersonen, die gemeinsam eine Wissensquelle aus Pfarrmatrikeln sowie weiteren schriftlichen und mündlichen Quellen entwickeln. Ihre Struktur erlaubt es jedem, der eine eigene Sammlung genealogischer Daten besitzt, diese der gemeinsamen Gesamtsammlung und dem Index hinzuzufügen. Für die Richtigkeit der Daten haftet weder die Einzelperson, die sie beigesteuert hat, noch die Kroatische Genealogische Gesellschaft „Pavao Ritter Vitezović".', warning: true },
      { text: 'Wenn Sie Ihren eigenen Stammbaum als Datenbank pflegen und sich mit Ihrer Arbeit den bisherigen Mitwirkenden anschließen möchten, exportieren Sie die Daten in eine GEDCOM-Datei (ohne Daten zu noch lebenden Personen) und senden Sie sie per <a href="mailto:rodoslovlje@rodoslovlje.hr">E-Mail</a> an den Administrator.' },
    ],
    it: [
      { text: '<strong>L\'Indice genealogico croato</strong> è una raccolta archivistica di dati su persone e famiglie in Croazia, costituita a partire dalle collezioni dei singoli genealogisti. Vi può cercare i nomi e i cognomi delle persone che sta ricercando, per scoprire se qualcun altro le abbia già individuate e descritte. L\'indice di base contiene nomi, date e luoghi di nascita, matrimonio e morte, nonché i collegamenti a genitori, partner e figli. A ogni voce è associato anche il cognome del genealogista &ndash; fornitore dei dati, il che permette al ricercatore di stabilire un ulteriore contatto, ne indica la direzione e spesso rende possibile la ricerca in una parrocchia individuata in modo indiretto. I dati di contatto dei genealogisti non sono pubblicati, ma non sarà difficile raggiungerli tramite la <a href="https://www.rodoslovlje.hr" target="_blank" rel="noopener">Società genealogica croata "Pavao Ritter Vitezović"</a>.' },
      { text: 'L\'applicazione offre opzioni avanzate di ricerca, ordinamento ed esportazione dei dati. Per istruzioni dettagliate sull\'utilizzo di tutte le funzionalità, consultare il <a href="#" onclick="document.getElementById(\'help-toggle-btn\')?.click(); return false;">manuale d\'uso</a>.' },
      { text: 'L\'indice delle famiglie può comprendere anche genitori che non si sono mai sposati o che addirittura non hanno mai vissuto insieme &ndash; un\'informazione che può rivelarsi preziosa per i discendenti o per altri ricercatori.' },
      { text: 'L\'indice è composto da dati provenienti da file GEDCOM che ci sono stati forniti da numerosi genealogisti, elencati nella pagina <a href="?t=contributors">Genealogisti</a>.' },
      { text: 'Avvertenza! L\'Indice genealogico croato ha carattere puramente informativo. La Società genealogica croata "Pavao Ritter Vitezović" declina ogni responsabilità per l\'esattezza dei dati forniti. La società è un\'associazione volontaria di persone che sviluppano insieme una fonte comune di conoscenza, attinta da registri parrocchiali e da altre fonti scritte e orali. La sua struttura consente a chiunque possieda una propria raccolta di dati genealogici di aggiungerla alla raccolta complessiva comune e all\'indice. Per l\'esattezza dei dati non rispondono né la singola persona che li ha forniti né la Società genealogica croata "Pavao Ritter Vitezović".', warning: true },
      { text: 'Se conserva il proprio albero genealogico in forma di database e desidera unirsi ai contributori già esistenti con i risultati del suo lavoro, esporti i dati in un file GEDCOM (esclusi i dati sulle persone viventi) e lo invii all\'amministratore tramite <a href="mailto:rodoslovlje@rodoslovlje.hr">e-mail</a>.' },
    ],
  },
};

export default siteConfig;
