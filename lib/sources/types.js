/**
 * @typedef {"USD"} Currency
 *
 * @typedef {Object} Offer
 * @property {"ebay"|"2ndswing"|"globalgolf"|"pgatss"|"golfgalaxy"|string} source
 * @property {string} retailer
 * @property {string} url
 * @property {string} title
 * @property {number} price
 * @property {Currency} currency
 * @property {string=} image
 * @property {Object=} specs
 * @property {"LEFT"|"RIGHT"=} specs.dexterity
 * @property {"BLADE"|"MALLET"=} specs.headType
 * @property {number=} specs.length
 * @property {string=} specs.shaft
 * @property {string=} specs.hosel
 * @property {string=} specs.face
 * @property {string=} specs.grip
 * @property {boolean=} specs.hasHeadcover
 * @property {string=} specs.toeHang
 * @property {number=} specs.loft
 * @property {number=} specs.lie
 * @property {{username?: string, feedbackPct?: number}=} seller
 * @property {string=} condition
 * @property {string=} conditionBand   // "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "USED"
 * @property {string=} brand
 * @property {string=} model
 * @property {string=} groupModel
 * @property {string=} productId
 * @property {string=} createdAt
 */

/**
 * @typedef {Object} SourceAdapter
 * @property {Offer["source"]} id
 * @property {(q: string, opts: { broaden?: boolean, page?: number }) => Promise<Offer[]>} fetch
 */
export {};
