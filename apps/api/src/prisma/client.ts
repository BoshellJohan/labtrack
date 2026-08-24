// Single import point for the generated Prisma client.
//
// Prisma 7 no longer publishes the client under '@prisma/client': it is
// generated into src/generated/prisma, a path that is git-ignored and rebuilt on
// every install. Re-exporting it here keeps that location an implementation
// detail — application code imports from 'src/prisma/client' and never from the
// generated folder, so moving the output means editing one line instead of
// every consumer.
export * from '../generated/prisma/client';
