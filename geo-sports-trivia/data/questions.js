// Off the Map — question bank.
//
// Every fact and coordinate here was checked against a primary source in July 2026.
// Coordinates are the venue itself where perfectKm is tight, the city centre where
// the answer is a metro. Wording is deliberately past tense for events that have
// already happened, so the bank does not rot.
//
// perfectKm: how close counts as a bullseye. ~15-30 km for a venue or small town,
// 40-50 km for a big metro.
// difficulty: 1 easy, 2 medium, 3 hard. Hard questions land on the heavy rounds.

const QUESTIONS = [
  {
    id: 'nhl-utah',
    sport: 'NHL',
    prompt: "Arizona's NHL team was sold in 2024 and its hockey operations moved here.",
    answer: { name: 'Salt Lake City, Utah, USA', lat: 40.7608, lon: -111.8910 },
    perfectKm: 50,
    difficulty: 2,
    fact: 'It played one season as Utah Hockey Club, then was renamed the Utah Mammoth in May 2025.'
  },
  {
    id: 'nba-okc',
    sport: 'NBA',
    prompt: 'The SuperSonics left Seattle in 2008 and became the Thunder here.',
    answer: { name: 'Oklahoma City, Oklahoma, USA', lat: 35.4676, lon: -97.5164 },
    perfectKm: 50,
    difficulty: 1,
    fact: 'Seattle had won the NBA title in 1979, thirty years before the move.'
  },
  {
    id: 'nfl-raiders',
    sport: 'NFL',
    prompt: 'The Raiders left Oakland in 2020 for Allegiant Stadium here.',
    answer: { name: 'Las Vegas, Nevada, USA', lat: 36.0909, lon: -115.1833 },
    perfectKm: 40,
    difficulty: 1,
    fact: 'It was their second move. They had already spent 1982 to 1994 in Los Angeles.'
  },
  {
    id: 'nfl-chargers',
    sport: 'NFL',
    prompt: 'The Chargers left San Diego in 2017 and now share SoFi Stadium with the Rams in this city.',
    answer: { name: 'Inglewood, California, USA', lat: 33.9535, lon: -118.3392 },
    perfectKm: 30,
    difficulty: 3,
    fact: 'SoFi Stadium hosted Super Bowl LVI in 2022.'
  },
  {
    id: 'mlb-as',
    sport: 'MLB',
    prompt: 'After leaving Oakland the Athletics moved into a Triple-A ballpark across the river from this state capital.',
    answer: { name: 'Sacramento, California, USA', lat: 38.5816, lon: -121.4944 },
    perfectKm: 40,
    difficulty: 2,
    fact: 'Sutter Health Park in West Sacramento holds them until a Las Vegas ballpark is ready.'
  },
  {
    id: 'nba-grizzlies',
    sport: 'NBA',
    prompt: 'The Grizzlies started life in Vancouver and relocated here in 2001.',
    answer: { name: 'Memphis, Tennessee, USA', lat: 35.1495, lon: -90.0490 },
    perfectKm: 50,
    difficulty: 1,
    fact: 'They kept the name, despite there being no grizzly bears in Tennessee.'
  },
  {
    id: 'fut-maracana',
    sport: 'Football',
    prompt: 'The Maracanã, host of the 1950 and 2014 World Cup finals, is in this city.',
    answer: { name: 'Rio de Janeiro, Brazil', lat: -22.9121, lon: -43.2302 },
    perfectKm: 40,
    difficulty: 1,
    fact: 'The 1950 final drew an official crowd near 174,000, the largest in football history.'
  },
  {
    id: 'fut-campnou',
    sport: 'Football',
    prompt: 'Camp Nou, home of FC Barcelona, is in this city.',
    answer: { name: 'Barcelona, Spain', lat: 41.3809, lon: 2.1228 },
    perfectKm: 30,
    difficulty: 1,
    fact: 'A rebuild is under way to take it to about 105,000 seats, which would again make it the biggest in Europe.'
  },
  {
    id: 'fut-bombonera',
    sport: 'Football',
    prompt: 'La Bombonera, home of Boca Juniors, is in this capital.',
    answer: { name: 'Buenos Aires, Argentina', lat: -34.6356, lon: -58.3648 },
    perfectKm: 40,
    difficulty: 1,
    fact: 'One flat, sheer stand gives it the nickname: the chocolate box.'
  },
  {
    id: 'fut-azteca',
    sport: 'Football',
    prompt: 'The first ground to host two World Cup finals, in 1970 and 1986, stands in this capital.',
    answer: { name: 'Mexico City, Mexico', lat: 19.3029, lon: -99.1505 },
    perfectKm: 40,
    difficulty: 1,
    fact: 'The Estadio Azteca was renamed Estadio Banorte in 2025 to fund its World Cup renovation.'
  },
  {
    id: 'fut-dortmund',
    sport: 'Football',
    prompt: "The 'Yellow Wall' terrace at Signal Iduna Park is here.",
    answer: { name: 'Dortmund, Germany', lat: 51.4925, lon: 7.4517 },
    perfectKm: 30,
    difficulty: 2,
    fact: 'It holds 24,454 standing fans, the largest terrace in European football.'
  },
  {
    id: 'fut-bernabeu',
    sport: 'Football',
    prompt: 'The Santiago Bernabéu is in this capital.',
    answer: { name: 'Madrid, Spain', lat: 40.4531, lon: -3.6883 },
    perfectKm: 30,
    difficulty: 1,
    fact: 'It is named after the Real Madrid president who had it built in 1947.'
  },
  {
    id: 'fut-lusail',
    sport: 'Football',
    prompt: 'The 2022 World Cup final was played at Lusail Stadium, about 20 km north of this capital.',
    answer: { name: 'Lusail, near Doha, Qatar', lat: 25.4209, lon: 51.4904 },
    perfectKm: 40,
    difficulty: 2,
    fact: 'Argentina beat France on penalties there after a 3-3 draw.'
  },
  {
    id: 'fut-metlife',
    sport: 'Football',
    prompt: 'Spain beat Argentina in the 2026 World Cup final at MetLife Stadium, in this New Jersey borough.',
    answer: { name: 'East Rutherford, New Jersey, USA', lat: 40.8135, lon: -74.0744 },
    perfectKm: 25,
    difficulty: 3,
    fact: 'Ferran Torres settled it in extra time in front of about 82,500 people.'
  },
  {
    id: 'cri-lords',
    sport: 'Cricket',
    prompt: "Lord's, the Home of Cricket, is in this city.",
    answer: { name: "Lord's, London, England", lat: 51.5294, lon: -0.1727 },
    perfectKm: 30,
    difficulty: 1,
    fact: 'The playing surface drops about 2.5 m from one side of the ground to the other.'
  },
  {
    id: 'cri-wankhede',
    sport: 'Cricket',
    prompt: 'India won the 2011 World Cup final at Wankhede Stadium here.',
    answer: { name: 'Mumbai, India', lat: 19.0176, lon: 72.8300 },
    perfectKm: 40,
    difficulty: 2,
    fact: 'MS Dhoni finished it with a six.'
  },
  {
    id: 'cri-mcg',
    sport: 'Cricket',
    prompt: 'The Boxing Day Test is played at the MCG in this city.',
    answer: { name: 'Melbourne, Australia', lat: -37.8200, lon: 144.9834 },
    perfectKm: 40,
    difficulty: 1,
    fact: 'The same ground hosted the very first Test match, in 1877.'
  },
  {
    id: 'rug-edenpark',
    sport: 'Rugby',
    prompt: 'Eden Park, where the All Blacks have not lost a Test since 1994, is in this city.',
    answer: { name: 'Auckland, New Zealand', lat: -36.8750, lon: 174.7447 },
    perfectKm: 30,
    difficulty: 2,
    fact: 'The run is past 50 Tests. Their last defeat there was to France in 1994.'
  },
  {
    id: 'f1-monaco',
    sport: 'F1',
    prompt: "This microstate's street circuit runs through Monte Carlo and around the harbour.",
    answer: { name: 'Monaco', lat: 43.7347, lon: 7.4206 },
    perfectKm: 15,
    difficulty: 1,
    fact: 'It is the slowest circuit on the calendar and has been raced since 1929.'
  },
  {
    id: 'f1-suzuka',
    sport: 'F1',
    prompt: 'Suzuka, the only figure-eight circuit on the F1 calendar, is in this part of Japan.',
    answer: { name: 'Suzuka, Mie Prefecture, Japan', lat: 34.8417, lon: 136.5389 },
    perfectKm: 30,
    difficulty: 3,
    fact: 'The back straight crosses over the rest of the track on an overpass.'
  },
  {
    id: 'f1-baku',
    sport: 'F1',
    prompt: "This Caspian capital's street circuit squeezes past a medieval walled old town.",
    answer: { name: 'Baku, Azerbaijan', lat: 40.3755, lon: 49.8535 },
    perfectKm: 40,
    difficulty: 2,
    fact: 'Its main straight runs over 2 km, the longest on the calendar.'
  },
  {
    id: 'golf-standrews',
    sport: 'Golf',
    prompt: 'The Old Course, the home of golf, is in this Scottish town.',
    answer: { name: 'St Andrews, Scotland', lat: 56.3433, lon: -2.8025 },
    perfectKm: 25,
    difficulty: 2,
    fact: 'The Open has been played here more often than anywhere else.'
  },
  {
    id: 'oly-2026',
    sport: 'Olympics',
    prompt: 'The 2026 Winter Olympics were co-hosted by Cortina d\'Ampezzo and this larger city.',
    answer: { name: 'Milan, Italy', lat: 45.4642, lon: 9.1900 },
    perfectKm: 40,
    difficulty: 1,
    fact: 'Held that February, they were the first Winter Games officially hosted by two cities.'
  },
  {
    id: 'oly-2032',
    sport: 'Olympics',
    prompt: 'The 2032 Summer Olympics were awarded to this city.',
    answer: { name: 'Brisbane, Australia', lat: -27.4698, lon: 153.0251 },
    perfectKm: 50,
    difficulty: 2,
    fact: "It will be Australia's third Summer Games, after Melbourne 1956 and Sydney 2000."
  },
  {
    id: 'ten-indianwells',
    sport: 'Tennis',
    prompt: 'The BNP Paribas Open is played in this California desert town.',
    answer: { name: 'Indian Wells, California, USA', lat: 33.7241, lon: -116.3056 },
    perfectKm: 25,
    difficulty: 3,
    fact: 'It is often called the fifth Grand Slam, though it is not one.'
  },
  {
    id: 'run-boston',
    sport: 'Running',
    prompt: "The world's oldest annual marathon finishes on Boylston Street here.",
    answer: { name: 'Boston, Massachusetts, USA', lat: 42.3505, lon: -71.0780 },
    perfectKm: 30,
    difficulty: 1,
    fact: 'It has been run every year since 1897, apart from 2020.'
  },
  {
    id: 'cyc-tdf',
    sport: 'Cycling',
    prompt: 'The Tour de France has finished on the Champs-Élysées in this city nearly every year since 1975.',
    answer: { name: 'Paris, France', lat: 48.8698, lon: 2.3078 },
    perfectKm: 30,
    difficulty: 1,
    fact: 'The 2024 finish moved to Nice, because Paris was busy hosting the Olympics.'
  },
  {
    id: 'bas-euroleague',
    sport: 'Basketball',
    prompt: 'EuroLeague rivals Panathinaikos and Olympiacos share this metro.',
    answer: { name: 'Athens, Greece', lat: 37.9838, lon: 23.7275 },
    perfectKm: 40,
    difficulty: 2,
    fact: 'Their meeting is known as the derby of the eternal enemies.'
  },
  {
    id: 'nhl-coyotes',
    sport: 'NHL',
    prompt: 'The original Winnipeg Jets relocated in 1996 and became the Coyotes here.',
    answer: { name: 'Phoenix, Arizona, USA', lat: 33.4484, lon: -112.0740 },
    perfectKm: 50,
    difficulty: 2,
    fact: 'Winnipeg got a second Jets team in 2011, when the Atlanta Thrashers moved north.'
  },
  {
    id: 'khl-ska',
    sport: 'Ice hockey',
    prompt: 'KHL club SKA plays in this Russian city on the Gulf of Finland.',
    answer: { name: 'Saint Petersburg, Russia', lat: 59.9311, lon: 30.3609 },
    perfectKm: 40,
    difficulty: 2,
    fact: 'SKA is the army club. The letters stand for Sports Club of the Army.'
  }
];
