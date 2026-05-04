"use strict";

const SERVICE_CATALOG = [
  {
    key: "classic-haircut",
    name: "Classic Haircut",
    category: "haircut",
    providerTypes: ["shop", "independent_stylist"],
    description: "A standard haircut for everyday grooming.",
  },
  {
    key: "skin-fade",
    name: "Skin Fade",
    category: "haircut",
    providerTypes: ["shop", "independent_stylist"],
    description: "A close fade blended into the top section.",
  },
  {
    key: "beard-trim",
    name: "Beard Trim",
    category: "beard",
    providerTypes: ["shop", "independent_stylist"],
    description: "A shaping and cleanup service for facial hair.",
  },
  {
    key: "hot-towel-shave",
    name: "Hot Towel Shave",
    category: "beard",
    providerTypes: ["shop", "independent_stylist"],
    description: "Traditional close shave with hot towel preparation.",
  },
  {
    key: "blow-dry-styling",
    name: "Blow Dry Styling",
    category: "styling",
    providerTypes: ["shop", "independent_stylist"],
    description: "Drying and finishing for a polished styled look.",
  },
  {
    key: "full-hair-color",
    name: "Full Hair Color",
    category: "color",
    providerTypes: ["shop"],
    description: "All-over color application for full coverage.",
  },
  {
    key: "root-touch-up",
    name: "Root Touch-Up",
    category: "color",
    providerTypes: ["shop"],
    description: "Color refresh for regrowth and root maintenance.",
  },
  {
    key: "highlights",
    name: "Highlights",
    category: "color",
    providerTypes: ["shop"],
    description: "Partial or full highlighting for added dimension.",
  },
  {
    key: "keratin-treatment",
    name: "Keratin Treatment",
    category: "treatment",
    providerTypes: ["shop"],
    description: "Smoothing treatment to reduce frizz and improve texture.",
  },
  {
    key: "deep-conditioning-treatment",
    name: "Deep Conditioning Treatment",
    category: "treatment",
    providerTypes: ["shop", "independent_stylist"],
    description: "Moisture and repair treatment for dry or damaged hair.",
  },
  {
    key: "bridal-hair-styling",
    name: "Bridal Hair Styling",
    category: "event",
    providerTypes: ["shop", "independent_stylist"],
    description: "Formal styling service for wedding and event looks.",
  },
  {
    key: "kids-haircut",
    name: "Kids Haircut",
    category: "haircut",
    providerTypes: ["shop", "independent_stylist"],
    description: "Haircut service tailored for children.",
  },
];

const CATALOG_BY_KEY = new Map(SERVICE_CATALOG.map((item) => [item.key, item]));

function listServiceCatalog({ providerType = null, category = null } = {}) {
  return SERVICE_CATALOG.filter((item) => {
    if (providerType && !item.providerTypes.includes(providerType)) {
      return false;
    }
    if (category && item.category !== category) {
      return false;
    }
    return true;
  });
}

function getServiceCatalogItem(key) {
  return CATALOG_BY_KEY.get(key) || null;
}

function isValidServiceCatalogKey(key) {
  return CATALOG_BY_KEY.has(key);
}

module.exports = {
  SERVICE_CATALOG,
  listServiceCatalog,
  getServiceCatalogItem,
  isValidServiceCatalogKey,
};
