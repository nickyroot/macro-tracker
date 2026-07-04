-- CreateTable
CREATE TABLE "allocations" (
    "date" DATE NOT NULL,
    "asset" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("date","asset")
);
