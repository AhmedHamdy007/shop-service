const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const request = require("supertest");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-discovery-test-"));
const privateKeyPath = path.join(tmpDir, "private.pem");
const publicKeyPath = path.join(tmpDir, "public.pem");
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
fs.writeFileSync(privateKeyPath, privateKey, "utf8");
fs.writeFileSync(publicKeyPath, publicKey, "utf8");

process.env.PORT = "4002";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "INFO";
process.env.DATABASE_URL = "postgresql://unused";
process.env.AUTH_SERVICE_URL = "http://localhost:4001";
process.env.JWT_PUBLIC_KEY_PATH = publicKeyPath;
process.env.JWT_ISSUER = "salon-platform.auth";
process.env.JWT_AUDIENCE = "salon-platform.api";

jest.mock("../src/db/pool", () => ({
  healthCheck: jest.fn(),
}));

jest.mock("../src/repositories/shopRepository", () => ({
  createShop: jest.fn(),
  findShopById: jest.fn(),
  findPublicShopById: jest.fn(),
  findActiveShopByOwnerUserId: jest.fn(),
  listShops: jest.fn(),
  updateShopById: jest.fn(),
}));

jest.mock("../src/repositories/serviceRepository", () => ({
  createService: jest.fn(),
  listServicesByShop: jest.fn(),
  findServiceById: jest.fn(),
  updateServiceById: jest.fn(),
}));

jest.mock("../src/repositories/staffRepository", () => ({
  listStaffByShop: jest.fn(),
  listActiveStylistsByShop: jest.fn(),
  findStaffById: jest.fn(),
  findStaffByShopAndUser: jest.fn(),
  findActiveMembershipByUser: jest.fn(),
  createStaffMembership: jest.fn(),
  updateStaffById: jest.fn(),
  listShopsForStylist: jest.fn(),
}));

jest.mock("../src/repositories/inviteRepository", () => ({
  createInvite: jest.fn(),
  listInvitesByShop: jest.fn(),
  findActiveInviteByShopAndEmail: jest.fn(),
  findInviteById: jest.fn(),
  findActiveInviteByToken: jest.fn(),
  markInviteAccepted: jest.fn(),
  revokeInvite: jest.fn(),
}));

jest.mock("../src/repositories/stylistProfileRepository", () => ({
  getByUserId: jest.fn(),
  getPublicProfileByIdentifier: jest.fn(),
  listPublicProfiles: jest.fn(),
  listPublicProfilesByShopId: jest.fn(),
  upsertByUserId: jest.fn(),
}));

jest.mock("../src/repositories/portfolioRepository", () => ({
  listByStylist: jest.fn(),
  findById: jest.fn(),
  createPost: jest.fn(),
  updatePost: jest.fn(),
  replaceMedia: jest.fn(),
  deletePost: jest.fn(),
}));

jest.mock("../src/repositories/offeringRepository", () => ({
  upsertOffering: jest.fn(),
  listByShopAndStylist: jest.fn(),
  deactivate: jest.fn(),
}));

const shopRepository = require("../src/repositories/shopRepository");
const stylistProfileRepository = require("../src/repositories/stylistProfileRepository");
const shopRoutes = require("../src/routes/shop.routes");
const stylistRoutes = require("../src/routes/stylist.routes");
const errorHandler = require("../src/middleware/errorHandler");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = "test-request-id";
    next();
  });
  app.use(shopRoutes);
  app.use(stylistRoutes);
  app.use(errorHandler);
  return app;
}

describe("Shop Service Sprint 3 discovery reads", () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    app = createApp();
  });

  it("lists public shops with discovery filters and sort options", async () => {
    shopRepository.listShops.mockResolvedValueOnce([
      {
        id: 7,
        name: "Owner Shop",
        slug: "owner-shop",
        city: "Kuala Lumpur",
        country: "Malaysia",
        stylistsCount: 2,
        servicesCount: 5,
      },
    ]);

    const res = await request(app).get(
      "/shops?city=Kuala%20Lumpur&q=owner&sort=stylists_desc&limit=12"
    );

    expect(res.status).toBe(200);
    expect(shopRepository.listShops).toHaveBeenCalledWith({
      city: "Kuala Lumpur",
      q: "owner",
      sort: "stylists_desc",
      limit: 12,
    });
    expect(res.body.count).toBe(1);
  });

  it("lists the shared service catalog for public discovery", async () => {
    const res = await request(app).get("/service-catalog?providerType=shop");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty("key");
    expect(res.body.data[0]).toHaveProperty("providerTypes");
  });

  it("returns a validation error for invalid shop discovery limit", async () => {
    const res = await request(app).get("/shops?limit=0");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("limit must be an integer between 1 and 100");
    expect(res.body.field).toBe("limit");
  });

  it("returns enriched public shop detail", async () => {
    shopRepository.findPublicShopById.mockResolvedValueOnce({
      id: 7,
      name: "Owner Shop",
      slug: "owner-shop",
      city: "Kuala Lumpur",
      country: "Malaysia",
      stylistsCount: 2,
      servicesCount: 5,
      isActive: true,
    });

    const res = await request(app).get("/shops/7");

    expect(res.status).toBe(200);
    expect(shopRepository.findPublicShopById).toHaveBeenCalledWith("7");
    expect(res.body.data.stylistsCount).toBe(2);
    expect(res.body.data.servicesCount).toBe(5);
  });

  it("supports the normalized public shop service-offerings route", async () => {
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      name: "Owner Shop",
      isActive: true,
    });
    const serviceRepository = require("../src/repositories/serviceRepository");
    serviceRepository.listServicesByShop.mockResolvedValueOnce([
      {
        id: 12,
        shopId: 7,
        catalogServiceKey: "classic-haircut",
        name: "Classic Haircut",
        durationMinutes: 45,
        price: 35,
        isActive: true,
      },
    ]);

    const res = await request(app).get("/shops/7/service-offerings");

    expect(res.status).toBe(200);
    expect(serviceRepository.listServicesByShop).toHaveBeenCalledWith(7);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].catalogServiceKey).toBe("classic-haircut");
  });

  it("lists public stylists for a specific shop detail page", async () => {
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      name: "Owner Shop",
      isActive: true,
    });
    stylistProfileRepository.listPublicProfilesByShopId.mockResolvedValueOnce([
      {
        userId: 9,
        displayName: "Ava Cuts",
        shopId: 7,
        shopName: "Owner Shop",
        staffLevel: "senior_stylist",
      },
    ]);

    const res = await request(app).get("/shops/7/stylists/public?limit=6");

    expect(res.status).toBe(200);
    expect(stylistProfileRepository.listPublicProfilesByShopId).toHaveBeenCalledWith(7, {
      limit: 6,
    });
    expect(res.body.count).toBe(1);
  });

  it("lists public stylists with discovery filters and sort options", async () => {
    stylistProfileRepository.listPublicProfiles.mockResolvedValueOnce([
      {
        userId: 9,
        displayName: "Ava Cuts",
        shopId: 7,
        shopName: "Owner Shop",
        staffLevel: "senior_stylist",
        portfolioCount: 3,
        serviceCount: 2,
      },
    ]);

    const res = await request(app).get(
      "/stylists?q=ava&city=Kuala%20Lumpur&shopId=7&staffLevel=senior_stylist&sort=experience_desc&limit=8"
    );

    expect(res.status).toBe(200);
    expect(stylistProfileRepository.listPublicProfiles).toHaveBeenCalledWith({
      q: "ava",
      city: "Kuala Lumpur",
      shopId: "7",
      staffLevel: "senior_stylist",
      sort: "experience_desc",
      limit: 8,
    });
    expect(res.body.count).toBe(1);
  });

  it("returns a validation error for invalid stylist discovery limit", async () => {
    const res = await request(app).get("/stylists?limit=abc");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("limit must be an integer between 1 and 100");
    expect(res.body.field).toBe("limit");
  });
});
