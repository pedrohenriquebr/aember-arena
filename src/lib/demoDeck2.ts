import type { CardFace, DeckInfo } from "./game";

const img = (file: string) => `https://mastervault-storage-prod.s3.amazonaws.com/media/card_front/en/${file}`;

const faces: CardFace[] = [
  { id: "c5ed37f7-0d05-48bc-a595-4f25c0ec1e6d", title: "Charette", house: "Dis", type: "Creature", image: img("341_081_GM7WM322M4_en.png"), text: "Play: Capture 3 amber.", amber: 0, power: 4, armor: 0, traits: "Demon" },
  { id: "b8343462-b5d7-48b0-9e3b-f020c5e73c55", title: "Tocsin", house: "Dis", type: "Creature", image: img("341_102_CG7PMM7PJ3G6_en.png"), text: "Reap: Your opponent discards a random card from their hand.", amber: 0, power: 3, armor: 0, traits: "Demon" },
  { id: "9ed7d241-1ca3-4a2a-b067-bb44776f7d4b", title: "The Terror", house: "Dis", type: "Creature", image: img("341_101_9W755VJWMG92_en.png"), text: "Play: If your opponent has no amber, gain 2 amber.", amber: 0, power: 5, armor: 0, traits: "Demon, Knight" },
  { id: "e5a1f190-6964-4b2e-bcb3-696d3f6f2713", title: "Gabos Longarms", house: "Dis", type: "Creature", image: img("341_086_33RP646XMQ93_en.png"), text: "Before Fight: Choose a creature. Gabos Longarms deals damage to that creature instead.", amber: 0, power: 5, armor: 0, traits: "Demon" },
  { id: "ba26515f-1705-45ba-ae42-dcb65685a0ec", title: "Tentacus", house: "Dis", type: "Creature", image: img("341_100_WQWQX27FH7M2_en.png"), text: "Your opponent must pay you 1 amber in order to use an artifact.", amber: 0, power: 5, armor: 0, traits: "Demon" },
  { id: "10715fd2-031a-47ca-9119-9b7b2ec1d2c0", title: "Fear", house: "Dis", type: "Action", image: img("341_058_7RV7CX53R83P_en.png"), text: "Play: Return an enemy creature to its owner's hand.", amber: 0, power: 0, armor: 0 },
  { id: "62c1aa96-491a-4dbe-a5a3-6895d55e2311", title: "Key Hammer", house: "Dis", type: "Action", image: img("341_066_RR9GCHVXP44C_en.png"), text: "Play: If your opponent forged a key last turn, unforge it. Your opponent gains 6 amber.", amber: 1, power: 0, armor: 0 },
  { id: "ea2a390e-e121-4cbd-96c5-2430cc600e81", title: "Mind Barb", house: "Dis", type: "Action", image: img("341_067_GJXV3PCXVPMW_en.png"), text: "Play: Your opponent discards a random card from their hand.", amber: 1, power: 0, armor: 0 },
  { id: "9644c85a-12a7-44ff-a8bb-877dddb46995", title: "Three Fates", house: "Dis", type: "Action", image: img("341_071_5P29489P6443_en.png"), text: "Play: Destroy the 3 most powerful creatures.", amber: 1, power: 0, armor: 0 },
  { id: "23a96d73-4eb2-4c45-9550-8207145eb587", title: "Lash of Broken Dreams", house: "Dis", type: "Artifact", image: img("341_075_5WF77V8WRRPP_en.png"), text: "Action: Keys cost +3 during your opponent's next turn.", amber: 0, power: 0, armor: 0, traits: "Weapon" },
  { id: "96548d93-b318-40e3-9f5c-3297c8070ebd", title: "Dominator Bauble", house: "Dis", type: "Artifact", image: img("341_073_QRQ93X7RG4J9_en.png"), text: "Action: Use a friendly creature.", amber: 0, power: 0, armor: 0, traits: "Item" },
  { id: "42fcdd0d-9be6-4602-ae47-1e8ef088751b", title: "Bulwark", house: "Sanctum", type: "Creature", image: img("341_238_4GJR4VPM7M26_en.png"), text: "Each of Bulwark's neighbors gets +2 armor.", amber: 0, power: 4, armor: 2, traits: "Human, Knight" },
  { id: "eec2bfbf-d019-4a7f-a0fa-2b8c8f16cd8d", title: "Lord Golgotha", house: "Sanctum", type: "Creature", image: img("341_252_VXMWR7MR5CW9_en.png"), text: "Before Fight: Deal 3 to each neighbor of the creature Lord Golgotha fights.", amber: 0, power: 5, armor: 2, traits: "Knight, Spirit" },
  { id: "cda55db6-24e5-4e79-ac36-28482898dd4f", title: "Grey Monk", house: "Sanctum", type: "Creature", image: img("341_244_4V54R77GCW9M_en.png"), text: "Each friendly creature gets +1 armor. Reap: Heal 2 damage from a creature.", amber: 0, power: 3, armor: 0, traits: "Human, Priest" },
  { id: "e40df662-6506-4a35-816d-efe29a0e4a6f", title: "Sequis", house: "Sanctum", type: "Creature", image: img("341_257_WC74XH7M2MJW_en.png"), text: "Reap: Capture 1 amber.", amber: 0, power: 4, armor: 2, traits: "Human, Knight" },
  { id: "b45eaa7a-22cd-4cd1-96bd-a240b63bea9f", title: "Staunch Knight", house: "Sanctum", type: "Creature", image: img("341_259_F6VVWM6QHCRR_en.png"), text: "Staunch Knight gets +2 power while it is on a flank.", amber: 0, power: 4, armor: 2, traits: "Human, Knight" },
  { id: "1da26e11-d319-4980-a2c3-931054ff008c", title: "Epic Quest", house: "Sanctum", type: "Artifact", image: img("341_231_9CW6R752CCQG_en.png"), text: "Play: Archive each friendly Knight creature in play.", amber: 0, power: 0, armor: 0, traits: "Quest" },
  { id: "4e9e09ba-66b9-4fc8-a61d-ca2dad320a5c", title: "Clear Mind", house: "Sanctum", type: "Action", image: img("341_216_4CVXQJV2QG3P_en.png"), text: "Play: Unstun each friendly creature.", amber: 1, power: 0, armor: 0 },
  { id: "c88c632e-743e-4f81-a9de-f61cddcbcaf5", title: "Virtuous Works", house: "Sanctum", type: "Action", image: img("341_230_848RC8PR567J_en.png"), text: "Gain 3 amber.", amber: 3, power: 0, armor: 0 },
  { id: "0b20bfe2-5664-4c1a-9e1a-22aa108d3786", title: "Cleansing Wave", house: "Sanctum", type: "Action", image: img("341_215_RFRWH2MX953_en.png"), text: "Play: Heal 1 damage from each creature. Gain 1 amber for each creature healed.", amber: 0, power: 0, armor: 0 },
  { id: "89b647b4-74b1-4e74-9812-1581e088f32e", title: "Terms of Redress", house: "Sanctum", type: "Action", image: img("341_227_VC53Q7XQ4C33_en.png"), text: "Play: Choose a friendly creature to capture 2 amber.", amber: 1, power: 0, armor: 0 },
  { id: "56252b23-94a4-46ac-a566-be6793ecbdfe", title: "Blinding Light", house: "Sanctum", type: "Action", image: img("341_213_P3Q4X37QMP7V_en.png"), text: "Play: Choose a house. Stun each creature of that house.", amber: 1, power: 0, armor: 0 },
  { id: "e52d5652-7365-4644-8b7f-e929035ca2c5", title: "Giant Sloth", house: "Untamed", type: "Creature", image: img("341_354_9QP6FJMQC6W8_en.png"), text: "Action: Gain 3 amber.", amber: 0, power: 6, armor: 0, traits: "Beast" },
  { id: "3680b506-9a5c-4afb-956d-15b08d1e9ecc", title: "Dust Pixie", house: "Untamed", type: "Creature", image: img("341_351_PFJXP2G7VWVP_en.png"), text: "Gains 2 amber when played.", amber: 2, power: 1, armor: 0, traits: "Faerie" },
  { id: "f0c4cb0f-8e5f-454c-a6ad-35f35ac3c98a", title: "Dew Faerie", house: "Untamed", type: "Creature", image: img("341_350_6X8HWG4MJPCC_en.png"), text: "Elusive. Reap: Gain 1 amber.", amber: 0, power: 2, armor: 0, traits: "Faerie" },
  { id: "ddd62eb0-4699-4fb0-9b63-43769186b509", title: "Snufflegator", house: "Untamed", type: "Creature", image: img("341_358_C2FM8V788JM5_en.png"), text: "Skirmish. When it fights, it takes no damage in return.", amber: 0, power: 4, armor: 0, traits: "Beast" },
  { id: "05fa104f-3719-41d0-9189-57ff3ec5edc1", title: "Witch of the Eye", house: "Untamed", type: "Creature", image: img("341_368_MC5PG9FQ3766_en.png"), text: "Reap: Return a card from your discard pile to your hand.", amber: 0, power: 3, armor: 0, traits: "Human, Witch" },
  { id: "dc6344a9-0486-4926-a820-d99eb2151c7f", title: "Ancient Bear", house: "Untamed", type: "Creature", image: img("341_345_V9F9WCXJ5VHR_en.png"), text: "Assault 2. Before this creature attacks, deal 2 to the attacked enemy.", amber: 0, power: 5, armor: 0, traits: "Beast" },
  { id: "afe27535-5cb7-43a1-8eab-ff9a6a472edb", title: "Vigor", house: "Untamed", type: "Action", image: img("341_338_CR6PV8PPC85R_en.png"), text: "Play: Heal up to 3 damage from a creature. If you healed 3, gain 1 amber.", amber: 1, power: 0, armor: 0 },
  { id: "74d1da3a-9d90-43ea-8ead-f7968c4d562d", title: "Regrowth", house: "Untamed", type: "Action", image: img("341_332_R2GQWP4RXCM4_en.png"), text: "Play: Return a creature from your discard pile to your hand.", amber: 1, power: 0, armor: 0 },
  { id: "68fbba20-4516-4e8a-8d3d-47e2cb401032", title: "Key Charge", house: "Untamed", type: "Action", image: img("341_325_66XVRV5PWMVG_en.png"), text: "Play: Lose 1 amber. If you do, you may forge a key at current cost.", amber: 0, power: 0, armor: 0 },
  { id: "459a6725-dcc0-4967-8cd4-a9bbb1548eda", title: "Lost in the Woods", house: "Untamed", type: "Action", image: img("341_327_W6VV383R4X8P_en.png"), text: "Play: Shuffle 2 friendly and 2 enemy creatures into their decks.", amber: 1, power: 0, armor: 0 },
  { id: "22c50a42-0b6e-4681-9632-3d315a76e849", title: "Save the Pack", house: "Untamed", type: "Action", image: img("341_333_4J9WMP4Q2F2G_en.png"), text: "Play: Destroy each damaged creature. Gain 1 chain.", amber: 0, power: 0, armor: 0 },
];

const order = [
  "10715fd2-031a-47ca-9119-9b7b2ec1d2c0", "62c1aa96-491a-4dbe-a5a3-6895d55e2311", "ea2a390e-e121-4cbd-96c5-2430cc600e81",
  "9644c85a-12a7-44ff-a8bb-877dddb46995", "96548d93-b318-40e3-9f5c-3297c8070ebd", "23a96d73-4eb2-4c45-9550-8207145eb587",
  "c5ed37f7-0d05-48bc-a595-4f25c0ec1e6d", "e5a1f190-6964-4b2e-bcb3-696d3f6f2713", "ba26515f-1705-45ba-ae42-dcb65685a0ec",
  "9ed7d241-1ca3-4a2a-b067-bb44776f7d4b", "9ed7d241-1ca3-4a2a-b067-bb44776f7d4b", "b8343462-b5d7-48b0-9e3b-f020c5e73c55",
  "56252b23-94a4-46ac-a566-be6793ecbdfe", "56252b23-94a4-46ac-a566-be6793ecbdfe", "0b20bfe2-5664-4c1a-9e1a-22aa108d3786",
  "4e9e09ba-66b9-4fc8-a61d-ca2dad320a5c", "89b647b4-74b1-4e74-9812-1581e088f32e", "c88c632e-743e-4f81-a9de-f61cddcbcaf5",
  "1da26e11-d319-4980-a2c3-931054ff008c", "42fcdd0d-9be6-4602-ae47-1e8ef088751b", "cda55db6-24e5-4e79-ac36-28482898dd4f",
  "eec2bfbf-d019-4a7f-a0fa-2b8c8f16cd8d", "e40df662-6506-4a35-816d-efe29a0e4a6f", "b45eaa7a-22cd-4cd1-96bd-a240b63bea9f",
  "68fbba20-4516-4e8a-8d3d-47e2cb401032", "459a6725-dcc0-4967-8cd4-a9bbb1548eda", "74d1da3a-9d90-43ea-8ead-f7968c4d562d",
  "22c50a42-0b6e-4681-9632-3d315a76e849", "22c50a42-0b6e-4681-9632-3d315a76e849", "afe27535-5cb7-43a1-8eab-ff9a6a472edb",
  "dc6344a9-0486-4926-a820-d99eb2151c7f", "f0c4cb0f-8e5f-454c-a6ad-35f35ac3c98a", "3680b506-9a5c-4afb-956d-15b08d1e9ecc",
  "e52d5652-7365-4644-8b7f-e929035ca2c5", "ddd62eb0-4699-4fb0-9b63-43769186b509", "05fa104f-3719-41d0-9189-57ff3ec5edc1",
];

const faceById = new Map(faces.map((face) => [face.id, face] as const));

export const DEMO_DECK_2_ID = "eb5d4c4a-5957-4276-ab9a-0d1b19f42e81";

export const DEMO_DECK_2: DeckInfo = {
  id: DEMO_DECK_2_ID,
  name: "Shadowmaster Desmares",
  houses: ["Dis", "Sanctum", "Untamed"],
  cards: order.map((id) => faceById.get(id)!).filter(Boolean),
  expansion: 341,
};
