import { auth } from "@clerk/nextjs/server";
import { ClaimComposer } from "./_components/claim-composer";

export default async function Home() {
  const { userId } = await auth();

  return (
    <section className="mx-auto w-full max-w-305 px-4 pb-20 pt-14 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <h1 className="display-lg mt-8 max-w-5xl text-high">
          Decipher the <span className="text-gradient">unseen</span> facts.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-8 text-muted sm:text-lg">
          Enter any statement, news clip, or article. Our verification engine
          cross-references millions of source nodes to deliver defensible truth.
        </p>
        {!userId ? (
          <p className="mt-3 body-md text-muted">
            Sign in or sign up from the top-right navigation to continue.
          </p>
        ) : null}

        <ClaimComposer className="mt-12" />
      </div>
    </section>
  );
}
