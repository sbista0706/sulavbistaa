// HD city imagery (Unsplash CDN, verified loading). Swap these URLs freely.
const W = (id: string, w = 2400) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

// Manhattan skyline, aerial daytime — primary hero.
export const CITY_HERO = W("1534430480872-3498386e7856");
// Manhattan at golden hour — secondary accent (empty states, upload).
export const CITY_SUNSET = W("1485871981521-5b1fd3805eee", 1600);
