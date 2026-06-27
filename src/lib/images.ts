// HD city imagery (Unsplash CDN, verified loading). Swap these URLs freely.
const W = (id: string, w = 2400) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

// Lower Manhattan at dusk — dark towers, warm gold city lights — primary hero.
export const CITY_HERO = W("1496588152823-86ff7695e68f");
// Manhattan at golden hour — secondary accent (empty states).
export const CITY_SUNSET = W("1485871981521-5b1fd3805eee", 1600);
