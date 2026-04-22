const ADJECTIVES = [
  'purple', 'golden', 'electric', 'lunar', 'velvet', 'amber', 'crimson',
  'frosty', 'silent', 'wandering', 'brave', 'curious', 'gentle', 'feral',
  'jolly', 'nimble', 'cosmic', 'dusty', 'serene', 'quiet', 'radiant',
  'plucky', 'mellow', 'sly', 'witty', 'bashful', 'bold', 'cheeky', 'keen',
  'lucid', 'merry', 'sunny', 'tidy', 'zesty',
];

const ANIMALS = [
  'alpaca', 'otter', 'narwhal', 'badger', 'capybara', 'hedgehog', 'axolotl',
  'pangolin', 'wombat', 'mongoose', 'okapi', 'quokka', 'fennec', 'lemur',
  'tapir', 'lynx', 'dingo', 'ibis', 'heron', 'gecko', 'penguin', 'puffin',
  'manatee', 'mantis', 'panda', 'orca', 'dormouse', 'weasel', 'ferret',
  'marmot',
];

export type GenerateOptions = { rng?: () => number };

export function generateSessionName(opts: GenerateOptions = {}): string {
  const rng = opts.rng ?? Math.random;
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]!;
  const animal = ANIMALS[Math.floor(rng() * ANIMALS.length)]!;
  return `${adj}-${animal}`;
}
