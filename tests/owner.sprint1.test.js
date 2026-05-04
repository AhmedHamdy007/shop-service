const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-owner-test-"));
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
const serviceRepository = require("../src/repositories/serviceRepository");
const staffRepository = require("../src/repositories/staffRepository");
const inviteRepository = require("../src/repositories/inviteRepository");
const offeringRepository = require("../src/repositories/offeringRepository");
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

function signAccessToken(sub = 1) {
  return jwt.sign({ sub }, privateKey, {
    algorithm: "RS256",
    issuer: "salon-platform.auth",
    audience: "salon-platform.api",
    keyid: "auth-rs256-k1",
    expiresIn: "15m",
  });
}

function mockCurrentUser(user) {
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ success: true, data: user }),
  });
}

describe("Shop Service Sprint 1 owner flows", () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    app = createApp();
  });

  it("allows an owner to create their first shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findActiveShopByOwnerUserId.mockResolvedValueOnce(null);
    shopRepository.createShop.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      name: "Owner Shop",
      slug: "owner-shop",
      addressLine1: "123 Main St",
      city: "Kuala Lumpur",
      country: "Malaysia",
      isActive: true,
    });

    const res = await request(app)
      .post("/shops")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        name: "Owner Shop",
        slug: "owner-shop",
        addressLine1: "123 Main St",
        city: "Kuala Lumpur",
        country: "Malaysia",
      });

    expect(res.status).toBe(201);
    expect(shopRepository.findActiveShopByOwnerUserId).toHaveBeenCalledWith(1);
    expect(shopRepository.createShop).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 1,
        name: "Owner Shop",
        slug: "owner-shop",
      })
    );
  });

  it("blocks an owner from creating a second active shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findActiveShopByOwnerUserId.mockResolvedValueOnce({
      id: 3,
      ownerUserId: 1,
      isActive: true,
    });

    const res = await request(app)
      .post("/shops")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        name: "Second Shop",
        slug: "second-shop",
        addressLine1: "123 Main St",
        city: "Kuala Lumpur",
        country: "Malaysia",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Owner already has an active shop");
    expect(shopRepository.createShop).not.toHaveBeenCalled();
  });

  it("rejects create shop when the authenticated user is not an owner", async () => {
    mockCurrentUser({ id: 2, email: "stylist@example.com", role: "stylist" });

    const res = await request(app)
      .post("/shops")
      .set("Authorization", `Bearer ${signAccessToken(2)}`)
      .send({
        name: "Blocked Shop",
        slug: "blocked-shop",
        addressLine1: "123 Main St",
        city: "Kuala Lumpur",
        country: "Malaysia",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Owner role required");
  });

  it("creates a stylist invite and blocks duplicate active invites for the same email", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValue({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    inviteRepository.findActiveInviteByShopAndEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99, shopId: 7, email: "stylist@example.com" });
    inviteRepository.createInvite.mockResolvedValueOnce({
      id: 21,
      shopId: 7,
      email: "stylist@example.com",
      staffLevel: "senior_stylist",
    });

    const token = signAccessToken(1);
    const createRes = await request(app)
      .post("/shops/7/staff/invites")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: "stylist@example.com",
        staffLevel: "senior_stylist",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.email).toBe("stylist@example.com");
    expect(createRes.body.data.inviteToken).toBeTruthy();

    const duplicateRes = await request(app)
      .post("/shops/7/staff/invites")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: "stylist@example.com",
        staffLevel: "stylist",
      });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error).toBe("An active invite already exists for this email");
  });

  it("assigns a service offering to an active stylist in the owner's shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    staffRepository.findStaffByShopAndUser.mockResolvedValueOnce({
      id: 4,
      shopId: 7,
      userId: 9,
      status: "active",
      staffLevel: "senior_stylist",
    });
    serviceRepository.findServiceById.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      isActive: true,
    });
    offeringRepository.upsertOffering.mockResolvedValueOnce({
      id: 18,
      shopId: 7,
      stylistUserId: 9,
      serviceId: 12,
      customPrice: 55,
      customDurationMinutes: 60,
      isActive: true,
    });

    const res = await request(app)
      .post("/shops/7/stylists/9/services")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        serviceId: 12,
        customPrice: 55,
        customDurationMinutes: 60,
      });

    expect(res.status).toBe(201);
    expect(offeringRepository.upsertOffering).toHaveBeenCalledWith({
      shopId: 7,
      stylistUserId: 9,
      serviceId: 12,
      customPrice: 55,
      customDurationMinutes: 60,
      isActive: true,
    });
  });

  it("updates an owned shop profile", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
      name: "Owner Shop",
      slug: "owner-shop",
      addressLine1: "123 Main St",
      city: "Kuala Lumpur",
      country: "Malaysia",
      phone: "+60123456789",
      email: "shop@example.com",
      description: "Original description",
    });
    shopRepository.updateShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
      name: "Owner Shop Updated",
      slug: "owner-shop-updated",
      addressLine1: "456 Main St",
      city: "Shah Alam",
      country: "Malaysia",
      phone: "+60111111111",
      email: "updated@example.com",
      description: "Updated description",
    });

    const res = await request(app)
      .patch("/shops/7")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        name: "Owner Shop Updated",
        slug: "owner-shop-updated",
        addressLine1: "456 Main St",
        city: "Shah Alam",
        country: "Malaysia",
        phone: "+60111111111",
        email: "updated@example.com",
        description: "Updated description",
      });

    expect(res.status).toBe(200);
    expect(shopRepository.updateShopById).toHaveBeenCalledWith(7, {
      name: "Owner Shop Updated",
      slug: "owner-shop-updated",
      address_line1: "456 Main St",
      city: "Shah Alam",
      country: "Malaysia",
      phone: "+60111111111",
      email: "updated@example.com",
      description: "Updated description",
    });
  });

  it("updates only a shop image without requiring slug in the request body", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
      name: "Owner Shop",
      slug: "owner-shop",
      addressLine1: "123 Main St",
      city: "Kuala Lumpur",
      country: "Malaysia",
      phone: "+60123456789",
      email: "shop@example.com",
      description: "Original description",
      imageUrl: null,
    });
    shopRepository.updateShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
      name: "Owner Shop",
      slug: "owner-shop",
      addressLine1: "123 Main St",
      city: "Kuala Lumpur",
      country: "Malaysia",
      imageUrl: "https://res.cloudinary.com/demo/image/upload/shop.jpg",
    });

    const res = await request(app)
      .patch("/shops/7")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        imageUrl: "https://res.cloudinary.com/demo/image/upload/shop.jpg",
      });

    expect(res.status).toBe(200);
    expect(shopRepository.updateShopById).toHaveBeenCalledWith(7, {
      image_url: "https://res.cloudinary.com/demo/image/upload/shop.jpg",
    });
  });

  it("rejects updating a shop owned by another owner", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 2,
      isActive: true,
      name: "Other Owner Shop",
      slug: "other-owner-shop",
      addressLine1: "123 Main St",
      city: "Kuala Lumpur",
      country: "Malaysia",
    });

    const res = await request(app)
      .patch("/shops/7")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        name: "Blocked Update",
        slug: "blocked-update",
        addressLine1: "456 Main St",
        city: "Shah Alam",
        country: "Malaysia",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can only update your own shop");
    expect(shopRepository.updateShopById).not.toHaveBeenCalled();
  });

  it("updates an existing service for the owner's shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    serviceRepository.findServiceById.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      name: "Haircut",
      description: "Classic cut",
      category: "Hair",
      durationMinutes: 45,
      price: 35,
    });
    serviceRepository.updateServiceById.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      name: "Premium Haircut",
      description: "Upgraded classic cut",
      category: "Hair",
      durationMinutes: 60,
      price: 45,
      isActive: true,
    });

    const res = await request(app)
      .patch("/shops/7/services/12")
      .set("Authorization", `Bearer ${signAccessToken(1)}`)
      .send({
        name: "Premium Haircut",
        description: "Upgraded classic cut",
        durationMinutes: 60,
        price: 45,
        category: "Hair",
      });

    expect(res.status).toBe(200);
    expect(serviceRepository.updateServiceById).toHaveBeenCalledWith(12, {
      name: "Premium Haircut",
      description: "Upgraded classic cut",
      category: "Hair",
      duration_minutes: 60,
      price: 45,
    });
  });

  it("soft deletes an existing service for the owner's shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    serviceRepository.findServiceById.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      isActive: true,
    });
    serviceRepository.updateServiceById.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      isActive: false,
    });

    const res = await request(app)
      .delete("/shops/7/services/12")
      .set("Authorization", `Bearer ${signAccessToken(1)}`);

    expect(res.status).toBe(200);
    expect(serviceRepository.updateServiceById).toHaveBeenCalledWith(12, {
      is_active: false,
    });
  });

  it("lists owner-facing staff, stylists, and invites for a shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValue({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    staffRepository.listStaffByShop.mockResolvedValueOnce([
      { id: 31, shopId: 7, userId: 9, status: "active", staffLevel: "senior_stylist" },
    ]);
    staffRepository.listActiveStylistsByShop.mockResolvedValueOnce([
      { id: 31, shopId: 7, userId: 9, status: "active", staffLevel: "senior_stylist" },
    ]);
    inviteRepository.listInvitesByShop.mockResolvedValueOnce([
      { id: 41, shopId: 7, email: "stylist@example.com", staffLevel: "stylist" },
    ]);

    const token = signAccessToken(1);
    const staffRes = await request(app)
      .get("/shops/7/staff")
      .set("Authorization", `Bearer ${token}`);
    const stylistRes = await request(app)
      .get("/shops/7/stylists")
      .set("Authorization", `Bearer ${token}`);
    const inviteRes = await request(app)
      .get("/shops/7/staff/invites")
      .set("Authorization", `Bearer ${token}`);

    expect(staffRes.status).toBe(200);
    expect(staffRes.body.count).toBe(1);
    expect(stylistRes.status).toBe(200);
    expect(stylistRes.body.count).toBe(1);
    expect(inviteRes.status).toBe(200);
    expect(inviteRes.body.count).toBe(1);
  });

  it("revokes an invite for the owner's shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValueOnce({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    inviteRepository.findInviteById.mockResolvedValueOnce({
      id: 41,
      shopId: 7,
      email: "stylist@example.com",
      staffLevel: "stylist",
    });
    inviteRepository.revokeInvite.mockResolvedValueOnce({
      id: 41,
      shopId: 7,
      email: "stylist@example.com",
      revokedAt: "2026-04-16T10:00:00.000Z",
    });

    const res = await request(app)
      .post("/shops/7/staff/invites/41/revoke")
      .set("Authorization", `Bearer ${signAccessToken(1)}`);

    expect(res.status).toBe(200);
    expect(inviteRepository.revokeInvite).toHaveBeenCalledWith(41);
  });

  it("updates and deactivates staff membership for the owner's shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValue({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    staffRepository.findStaffById
      .mockResolvedValueOnce({
        id: 31,
        shopId: 7,
        userId: 9,
        status: "active",
        staffLevel: "stylist",
      })
      .mockResolvedValueOnce({
        id: 31,
        shopId: 7,
        userId: 9,
        status: "active",
        staffLevel: "senior_stylist",
      });
    staffRepository.updateStaffById
      .mockResolvedValueOnce({
        id: 31,
        shopId: 7,
        userId: 9,
        status: "active",
        staffLevel: "senior_stylist",
      })
      .mockResolvedValueOnce({
        id: 31,
        shopId: 7,
        userId: 9,
        status: "inactive",
        staffLevel: "senior_stylist",
      });

    const token = signAccessToken(1);
    const updateRes = await request(app)
      .patch("/shops/7/staff/31")
      .set("Authorization", `Bearer ${token}`)
      .send({
        staffLevel: "senior_stylist",
        status: "active",
      });

    const deleteRes = await request(app)
      .delete("/shops/7/staff/31")
      .set("Authorization", `Bearer ${token}`);

    expect(updateRes.status).toBe(200);
    expect(staffRepository.updateStaffById).toHaveBeenNthCalledWith(1, 31, {
      staff_level: "senior_stylist",
      status: "active",
    });
    expect(deleteRes.status).toBe(200);
    expect(staffRepository.updateStaffById).toHaveBeenNthCalledWith(2, 31, {
      status: "inactive",
    });
  });

  it("lists and deactivates stylist offerings for the owner's shop", async () => {
    mockCurrentUser({ id: 1, email: "owner@example.com", role: "owner" });
    shopRepository.findShopById.mockResolvedValue({
      id: 7,
      ownerUserId: 1,
      isActive: true,
    });
    offeringRepository.listByShopAndStylist.mockResolvedValueOnce([
      {
        id: 91,
        shopId: 7,
        stylistUserId: 9,
        serviceId: 12,
        isActive: true,
      },
    ]);
    offeringRepository.deactivate.mockResolvedValueOnce({
      id: 91,
      shopId: 7,
      stylistUserId: 9,
      serviceId: 12,
      isActive: false,
    });

    const token = signAccessToken(1);
    const listRes = await request(app)
      .get("/shops/7/stylists/9/services")
      .set("Authorization", `Bearer ${token}`);
    const deleteRes = await request(app)
      .delete("/shops/7/stylists/9/services/12")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBe(1);
    expect(deleteRes.status).toBe(200);
    expect(offeringRepository.deactivate).toHaveBeenCalledWith(7, "9", "12");
  });
});
