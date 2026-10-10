// Question source: a shuffled trivia deck mixed with generated arithmetic,
// so a game never runs out of questions.
(function (exports) {
  'use strict';

  // [prompt, correct answer, ...wrong answers]
  const TRIVIA = [
    ['What is the largest planet in our solar system?', 'Jupiter', 'Saturn', 'Neptune', 'Earth'],
    ['How many continents are there?', '7', '5', '6', '8'],
    ['Which gas do plants take in for photosynthesis?', 'Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'],
    ['What is the capital of Japan?', 'Tokyo', 'Kyoto', 'Osaka', 'Seoul'],
    ['What is the chemical symbol for gold?', 'Au', 'Ag', 'Gd', 'Go'],
    ['How many sides does a hexagon have?', '6', '5', '7', '8'],
    ['Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury'],
    ['What is the largest ocean on Earth?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
    ['At what temperature does water freeze in Celsius?', '0°C', '32°C', '100°C', '-10°C'],
    ['Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Vincent van Gogh', 'Pablo Picasso'],
    ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
    ['How many legs does a spider have?', '8', '6', '10', '12'],
    ['What is the hardest natural substance?', 'Diamond', 'Gold', 'Iron', 'Quartz'],
    ['Which organ pumps blood through the body?', 'Heart', 'Lungs', 'Liver', 'Kidneys'],
    ['Which river flows through Egypt?', 'Nile', 'Amazon', 'Danube', 'Ganges'],
    ['What is the smallest prime number?', '2', '1', '3', '0'],
    ['Which country is home to the kangaroo?', 'Australia', 'Brazil', 'South Africa', 'India'],
    ['What color do you get by mixing blue and yellow?', 'Green', 'Purple', 'Orange', 'Brown'],
    ['What is the closest star to Earth?', 'The Sun', 'Proxima Centauri', 'Sirius', 'Polaris'],
    ['In which year did humans first land on the Moon?', '1969', '1959', '1972', '1965'],
    ['What is the largest mammal?', 'Blue whale', 'African elephant', 'Giraffe', 'Orca'],
    ['What is the capital of Canada?', 'Ottawa', 'Toronto', 'Vancouver', 'Montreal'],
    ['How many bones are in the adult human body?', '206', '186', '212', '250'],
    ['Which planet has the most famous rings?', 'Saturn', 'Jupiter', 'Uranus', 'Neptune'],
    ['What is the main language spoken in Brazil?', 'Portuguese', 'Spanish', 'French', 'English'],
    ['At sea level, water boils at what temperature in Fahrenheit?', '212°F', '100°F', '180°F', '232°F'],
    ['Who wrote "Romeo and Juliet"?', 'William Shakespeare', 'Charles Dickens', 'Jane Austen', 'Mark Twain'],
    ['What is the tallest mountain above sea level?', 'Mount Everest', 'K2', 'Kilimanjaro', 'Denali'],
    ['Which is the largest country by area?', 'Russia', 'Canada', 'China', 'United States'],
    ['How many players does a soccer team have on the field?', '11', '9', '10', '12'],
    ["What is the most common gas in Earth's atmosphere?", 'Nitrogen', 'Oxygen', 'Carbon dioxide', 'Argon'],
    ['Which metal is liquid at room temperature?', 'Mercury', 'Lead', 'Aluminum', 'Tin'],
    ['What is the currency of Japan?', 'Yen', 'Won', 'Yuan', 'Baht'],
    ['What does a caterpillar turn into?', 'Butterfly', 'Beetle', 'Dragonfly', 'Grasshopper'],
    ['How many days are in a leap year?', '366', '365', '364', '367'],
    ['Which animal is known as the "King of the Jungle"?', 'Lion', 'Tiger', 'Gorilla', 'Elephant'],
    ['What is the capital of France?', 'Paris', 'Lyon', 'Marseille', 'Nice'],
    ['How many hours are in a day?', '24', '12', '36', '48'],
    ['Which instrument has 88 keys?', 'Piano', 'Guitar', 'Violin', 'Flute'],
    ['What part of the plant makes food using sunlight?', 'Leaf', 'Root', 'Stem', 'Flower'],
  ].map(([prompt, answer, ...wrong]) => ({ prompt, answer, wrong }));

  function randInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function shuffle(items, rng) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Shuffle the correct answer in among the wrong ones.
  function toQuestion(prompt, answer, wrong, rng) {
    const choices = shuffle([answer, ...wrong], rng);
    return { prompt, choices, answerIndex: choices.indexOf(answer) };
  }

  function makeMathQuestion(rng) {
    let a, b, answer, symbol;
    switch (randInt(rng, 0, 3)) {
      case 0:
        a = randInt(rng, 2, 99);
        b = randInt(rng, 2, 99);
        answer = a + b;
        symbol = '+';
        break;
      case 1:
        a = randInt(rng, 10, 99);
        b = randInt(rng, 1, a);
        answer = a - b;
        symbol = '−';
        break;
      case 2:
        a = randInt(rng, 2, 12);
        b = randInt(rng, 2, 12);
        answer = a * b;
        symbol = '×';
        break;
      default:
        b = randInt(rng, 2, 12);
        answer = randInt(rng, 2, 12);
        a = b * answer;
        symbol = '÷';
    }
    // Close-but-wrong distractors so the right answer isn't obvious.
    const wrong = new Set();
    while (wrong.size < 3) {
      const offset = randInt(rng, 1, 10) * (rng() < 0.5 ? -1 : 1);
      const candidate = answer + offset;
      if (candidate >= 0) wrong.add(candidate);
    }
    return toQuestion(`What is ${a} ${symbol} ${b}?`, String(answer), [...wrong].map(String), rng);
  }

  function createQuestionSource(rng = Math.random) {
    let deck = [];
    return {
      next() {
        if (rng() < 0.5) return makeMathQuestion(rng);
        if (deck.length === 0) deck = shuffle(TRIVIA, rng);
        const t = deck.pop();
        return toQuestion(t.prompt, t.answer, t.wrong, rng);
      },
    };
  }

  Object.assign(exports, { TRIVIA, makeMathQuestion, createQuestionSource });
})(typeof module !== 'undefined' ? module.exports : (window.BrainBucksQuestions = {}));
