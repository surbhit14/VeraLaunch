import { defineChain } from 'viem'

export const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Testnet',
  nativeCurrency: { name: 'STT', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://api.infra.testnet.somnia.network'] },
  },
  blockExplorers: {
    default: {
      name: 'SocialScan',
      url: 'https://somnia-testnet.socialscan.io',
    },
  },
  testnet: true,
})
