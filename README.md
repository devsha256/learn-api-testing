mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report ^
"-Denv=dev" ^
"-Djava.util.logging.manager=org.jboss.byteman.agent.logging.BytemanLogManager" ^
"-DargLine=-javaagent:C:/tools/byteman-download-4.0.20/lib/byteman.jar=script:C:/full/path/to/munit-leak-detector.btm -Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true -Dmunit.strict.mode=true"
