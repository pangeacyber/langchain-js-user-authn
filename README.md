# Authenticating Users for Access Control with RAG for LangChain in JavaScript

An example JavaScript app demonstrating how to integrate Pangea's [AuthN][]
and [AuthZ][] services into a LangChain app to filter out RAG documents based on
user permissions.

## Prerequisites

- Node.js v22.
- A [Pangea account][Pangea signup] with AuthN and AuthZ enabled.
- An [OpenAI API key][OpenAI API keys].

## Setup

### Pangea AuthN

After activating AuthN, under AuthN > General > Redirect (Callback) Settings,
add `http://localhost:3000` as a redirect and save.

Under AuthN > Users > New > Create User, create at least one user.

### Pangea AuthZ

The setup in AuthZ should look something like this:

#### Resource types

| Name        | Permissions |
| ----------- | ----------- |
| engineering | read        |
| finance     | read        |

#### Roles & access

> [!TIP]
> At this point you need to create 2 new Roles under the `Roles & Access` tab in
> the Pangea console named `engineering` and `finance`.

##### Role: engineering

| Resource type | Permissions (read) |
| ------------- | ------------------ |
| engineering   | ✔️                 |
| finance       | ❌                 |

##### Role: finance

| Resource type | Permissions (read) |
| ------------- | ------------------ |
| engineering   | ❌                 |
| finance       | ✔️                 |

### Assigned roles & relations

| Subject type | Subject ID          | Role/Relation |
| ------------ | ------------------- | ------------- |
| user         | your AuthN username | engineering   |
| user         | bob@example.org     | finance       |

### Repository

```shell
git clone https://github.com/pangeacyber/langchain-js-user-authn.git
cd langchain-js-user-authn
npm install
cp .env.example .env
```

Fill in the values in `.env` and then the app can be run like so:

Let's assume the current user is "alice@example.org" and that they should have
permission to see engineering documents. They can query the LLM on information
regarding those documents:

```shell
npm run demo -- "What is the software architecture of the company?"
```

This will open a new tab in the user's default web browser where they can login
through AuthN. Afterwards, their permissions are checked against AuthZ and they
will indeed receive a response that is derived from the engineering documents:

```
The company's software architecture consists of a frontend built with React.js,
Redux, Axios, and Material-UI. The backend is developed using Node.js and
Express.js, while MongoDB is utilized for the database. Authentication and
authorization are managed through JSON Web Tokens (JWT) and OAuth 2.0, with
version control handled by Git and GitHub.
```

But they cannot query finance information:

```
$ npm run demo -- "What is the top salary in the Engineering department?"

[login flow]

I don't know.
```

And vice versa for "bob", who is in finance but not engineering.

[AuthN]: https://pangea.cloud/docs/authn/
[AuthZ]: https://pangea.cloud/docs/authz/
[Pangea signup]: https://pangea.cloud/signup
[OpenAI API keys]: https://platform.openai.com/api-keys
